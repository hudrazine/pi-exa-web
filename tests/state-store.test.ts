import fs from "node:fs/promises";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createStateStore } from "../src/state-store.ts";
import { credentials } from "./fixtures/oauth-state.ts";

let dir: string;
const children: ChildProcess[] = [];
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "pi-exa-state-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        const exit = once(child, "exit");
        child.kill("SIGKILL");
        await exit;
      }
    }),
  );
  await fs.rm(dir, { recursive: true, force: true });
});
const defaults = { version: 1, strategy: "anonymous-first" } as const;
const authenticated = { version: 1, strategy: "authenticated-first" } as const;
const path = (name: string) => join(dir, "exa-web", name);
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function worker(mode: string, strategy = "", agentDir = dir, flags: string[] = []) {
  const child = fork(
    fileURLToPath(new URL("./fixtures/state-worker.ts", import.meta.url)),
    [mode, strategy],
    {
      execArgv: flags,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  children.push(child);
  const messages: unknown[] = [];
  let stderr = "";
  child.stderr!.on("data", (data) => {
    stderr += String(data);
  });
  child.on("message", (message) => {
    messages.push(message);
  });
  return {
    child,
    messages,
    async wait(message: unknown) {
      await vi.waitFor(
        () => {
          expect(child.exitCode, stderr).not.toBe(1);
          expect(messages).toContainEqual(message);
        },
        { timeout: 15_000, interval: 10 },
      );
    },
  };
}

describe("state records", () => {
  test("preserves SDK discovery with optional metadata absent and issuer stamps intact", async () => {
    const next = structuredClone(credentials);
    next.discovery = { authorizationServerUrl: "https://auth.example.test" };
    const store = createStateStore();
    await store.updateOAuth(async () => next);
    expect((await store.readOAuth()).credentials).toEqual(next);
  });
  test("preserves SDK-valid parent resources, trailing slashes and OIDC discovery", async () => {
    const next = structuredClone(credentials);
    next.discovery.authorizationServerUrl += "/";
    next.discovery.resourceMetadata!.resource = "https://mcp.exa.ai/";
    next.discovery.authorizationServerMetadata = {
      ...next.discovery.authorizationServerMetadata!,
      jwks_uri: "https://auth.example.test/jwks",
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    };
    const store = createStateStore();
    await store.updateOAuth(async () => next);
    expect((await store.readOAuth()).credentials).toEqual(next);
  });
  test("rejects invalid proposed settings and credentials before replacing state", async () => {
    const store = createStateStore();
    // @ts-expect-error Invalid command input must also be rejected at runtime.
    await expect(store.writeSettings({ ...defaults, version: 2 })).rejects.toMatchObject({
      code: "storage",
    });
    expect(await fs.readdir(dir)).toEqual([]);
    const old = await store.updateOAuth(async () => credentials);
    await expect(
      store.updateOAuth(async (latest) => {
        latest.revision = 999;
        return { ...credentials, tokens: { ...credentials.tokens, expires_in: -1 } };
      }),
    ).rejects.toMatchObject({ code: "storage" });
    expect(await store.readOAuth()).toEqual(old);
    expect(
      await store.updateOAuth(async (latest) => {
        latest.revision = 999;
        return undefined;
      }),
    ).toEqual(old);
  });
  test("reads defaults without creating state or SQLite", async () => {
    const store = createStateStore();
    expect(await store.readSettings()).toEqual(defaults);
    expect(await store.readOAuth()).toEqual({ version: 1, revision: 0, credentials: null });
    expect(await fs.readdir(dir)).toEqual([]);
  });
  test("round trips SDK 2.0.0 credentials, null revisions and unchanged updates", async () => {
    const store = createStateStore();
    expect(await store.writeSettings(authenticated)).toEqual(authenticated);
    expect(await fs.readdir(join(dir, "exa-web"))).toEqual(["settings.json"]);
    const committed = await store.updateOAuth(async () => credentials, { expectedRevision: 0 });
    expect(committed).toEqual({ version: 1, revision: 1, credentials });
    expect(await createStateStore().readOAuth()).toEqual(committed);
    expect(await store.updateOAuth(async () => undefined)).toEqual(committed);
    await expect(
      store.updateOAuth(async () => null, { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "storage-conflict" });
    expect(await store.readOAuth()).toEqual(committed);
    expect(await store.updateOAuth(async () => null)).toEqual({
      version: 1,
      revision: 2,
      credentials: null,
    });
    expect((await store.updateOAuth(async () => credentials)).revision).toBe(3);
    expect(await store.readSettings()).toEqual(authenticated);
  });
  test.each([
    "{storage-sentinel",
    '{"version":2,"strategy":"anonymous-first"}',
    '{"version":1,"strategy":"invalid"}',
    '{"version":1,"strategy":"anonymous-first","revision":1}',
  ])("rejects existing invalid settings without replacing them: %s", async (content) => {
    await fs.mkdir(join(dir, "exa-web"), { mode: 0o700 });
    await fs.writeFile(path("settings.json"), content, { mode: 0o600 });
    await expect(createStateStore().writeSettings(authenticated)).rejects.toMatchObject({
      code: "storage",
    });
    expect(await fs.readFile(path("settings.json"), "utf8")).toBe(content);
  });
  test.each([
    { version: 2, revision: 0, credentials: null },
    { version: 1, revision: -1, credentials: null },
    { version: 1, revision: 0.5, credentials: null },
    { version: 1, revision: 0, credentials: {} },
    { version: 1, revision: 0, credentials: { ...credentials, resource: "https://other.example" } },
    {
      version: 1,
      revision: 0,
      credentials: {
        ...credentials,
        tokens: { ...credentials.tokens, issuer: "https://other.example" },
      },
    },
    { version: 1, revision: 0, credentials: { ...credentials, verifier: "storage-sentinel" } },
    {
      version: 1,
      revision: 0,
      credentials: {
        ...credentials,
        tokens: { ...credentials.tokens, apiKey: "storage-sentinel" },
      },
    },
  ])("rejects invalid OAuth without mutation %#", async (value) => {
    await fs.mkdir(join(dir, "exa-web"), { mode: 0o700 });
    const content = JSON.stringify(value);
    await fs.writeFile(path("oauth.json"), content, { mode: 0o600 });
    const update = vi.fn(async () => null);
    const error = await createStateStore()
      .updateOAuth(update)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "storage" });
    expect(inspect(error, { depth: 10 })).not.toContain("storage-sentinel");
    expect(error).not.toHaveProperty("cause");
    expect(update).not.toHaveBeenCalled();
    expect(await fs.readFile(path("oauth.json"), "utf8")).toBe(content);
  });
  test("rejects revision overflow and unreadable files", async () => {
    await fs.mkdir(join(dir, "exa-web"), { mode: 0o700 });
    await fs.writeFile(
      path("oauth.json"),
      JSON.stringify({ version: 1, revision: Number.MAX_SAFE_INTEGER, credentials: null }),
      { mode: 0o600 },
    );
    await expect(createStateStore().updateOAuth(async () => null)).rejects.toMatchObject({
      code: "storage",
    });
    vi.spyOn(fs, "readFile").mockRejectedValue(
      Object.assign(new Error("storage-sentinel"), { code: "EACCES" }),
    );
    await expect(createStateStore().readSettings()).rejects.toMatchObject({ code: "storage" });
    await expect(createStateStore().readOAuth()).rejects.toMatchObject({ code: "storage" });
  });
  test.skipIf(process.platform === "win32")(
    "verifies directory and secret modes before writing",
    async () => {
      const store = createStateStore();
      await store.updateOAuth(async () => credentials);
      expect((await fs.stat(join(dir, "exa-web"))).mode & 0o777).toBe(0o700);
      expect((await fs.stat(path("oauth.json"))).mode & 0o777).toBe(0o600);
      await fs.chmod(path("oauth.json"), 0o644);
      await expect(store.updateOAuth(async () => null)).rejects.toMatchObject({ code: "storage" });
      await fs.chmod(path("oauth.json"), 0o600);
      await fs.chmod(join(dir, "exa-web"), 0o755);
      await expect(store.updateOAuth(async () => null)).rejects.toMatchObject({ code: "storage" });
      expect((await store.readOAuth()).credentials).toEqual(credentials);
    },
  );
});

describe("replacement boundaries", () => {
  test.each(["settings", "oauth"])(
    "a failed %s rename preserves committed state and cleans its temporary file",
    async (kind) => {
      const store = createStateStore();
      await store.writeSettings(defaults);
      const before = await store.updateOAuth(async () => credentials);
      const rename = vi.spyOn(fs, "rename").mockRejectedValue(new Error("storage-sentinel"));
      const attempt =
        kind === "settings"
          ? store.writeSettings(authenticated)
          : store.updateOAuth(async () => null);
      await expect(attempt).rejects.toMatchObject({ code: "storage" });
      expect(rename).toHaveBeenCalledTimes(1);
      expect(await store.readSettings()).toEqual(defaults);
      expect(await store.readOAuth()).toEqual(before);
      expect(
        (await fs.readdir(join(dir, "exa-web"))).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);
      rename.mockRestore();
      expect((await store.updateOAuth(async () => null)).revision).toBe(2);
    },
  );
  test.each(["settings", "oauth"])(
    "failed %s temporary writes never rename or alter committed state",
    async (kind) => {
      const store = createStateStore();
      await store.writeSettings(defaults);
      const oauth = await store.updateOAuth(async () => credentials);
      const open = fs.open;
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await open(...args);
        vi.spyOn(handle, "writeFile").mockRejectedValue(new Error("storage-sentinel"));
        return handle;
      });
      const rename = vi.spyOn(fs, "rename");
      await expect(
        kind === "settings"
          ? store.writeSettings(authenticated)
          : store.updateOAuth(async () => null),
      ).rejects.toMatchObject({ code: "storage" });
      expect(rename).not.toHaveBeenCalled();
      expect(await store.readSettings()).toEqual(defaults);
      expect(await store.readOAuth()).toEqual(oauth);
      expect(
        (await fs.readdir(join(dir, "exa-web"))).filter((file) => file.endsWith(".tmp")),
      ).toEqual([]);
    },
  );
  test("a failed writer cannot remove another writer's pending temporary file", async () => {
    const store = createStateStore();
    await store.writeSettings(defaults);
    const firstReady = gate(),
      secondReady = gate(),
      firstRelease = gate(),
      secondRelease = gate();
    const rename = fs.rename;
    let calls = 0;
    let secondTemporary = "";
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (++calls === 1) {
        firstReady.resolve();
        await firstRelease.promise;
        throw new Error("storage-sentinel");
      }
      secondTemporary = String(from);
      secondReady.resolve();
      await secondRelease.promise;
      return rename(from, to);
    });
    const failed = store.writeSettings(defaults).catch((error: unknown) => error);
    await firstReady.promise;
    const successful = store.writeSettings(authenticated);
    await secondReady.promise;
    firstRelease.resolve();
    expect(await failed).toMatchObject({ code: "storage" });
    expect(JSON.parse(await fs.readFile(secondTemporary, "utf8"))).toEqual(authenticated);
    secondRelease.resolve();
    await successful;
    expect(await store.readSettings()).toEqual(authenticated);
  });
  test("OAuth retains exclusion until JSON replacement, including cancellation during that wait", async () => {
    const store = createStateStore();
    const ready = gate(),
      release = gate();
    const rename = fs.rename;
    let first = true;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (first) {
        first = false;
        ready.resolve();
        await release.promise;
      }
      return rename(from, to);
    });
    const owner = store.updateOAuth(async () => credentials);
    await ready.promise;
    const controller = new AbortController();
    const entered = vi.fn(async () => null);
    const waiter = store
      .updateOAuth(entered, { signal: controller.signal })
      .catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(entered).not.toHaveBeenCalled();
    const reason = new Error("storage-sentinel");
    controller.abort(reason);
    expect(await waiter).toBe(reason);
    release.resolve();
    await owner;
    expect((await store.readOAuth()).revision).toBe(1);
    expect(entered).not.toHaveBeenCalled();
  });
  test.each([false, true])(
    "settings replacement order controls the winner; late writer fails=%s",
    async (fail) => {
      const store = createStateStore();
      await store.writeSettings(defaults);
      const ready = gate(),
        release = gate();
      const rename = fs.rename;
      let calls = 0;
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (++calls === 1) {
          ready.resolve();
          await release.promise;
          if (fail) throw new Error("storage-sentinel");
        }
        await rename(from, to);
      });
      const first = store.writeSettings(defaults);
      const settled = first.catch((error: unknown) => error);
      await ready.promise;
      await createStateStore().writeSettings(authenticated);
      expect(await store.readSettings()).toEqual(authenticated);
      release.resolve();
      if (fail) expect(await settled).toMatchObject({ code: "storage" });
      else await first;
      expect(await store.readSettings()).toEqual(fail ? authenticated : defaults);
      expect(await fs.readdir(join(dir, "exa-web"))).toEqual(["settings.json"]);
    },
  );
  test.each(["settings", "oauth"])(
    "readers observe complete records around %s replacement",
    async (kind) => {
      const store = createStateStore();
      await store.writeSettings(defaults);
      const oldOAuth = await store.updateOAuth(async () => credentials);
      const ready = gate(),
        release = gate();
      const rename = fs.rename;
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        ready.resolve();
        await release.promise;
        return rename(from, to);
      });
      const write =
        kind === "settings"
          ? store.writeSettings(authenticated)
          : store.updateOAuth(async () => null);
      await ready.promise;
      for (let i = 0; i < 10; i++)
        expect(await (kind === "settings" ? store.readSettings() : store.readOAuth())).toEqual(
          kind === "settings" ? defaults : oldOAuth,
        );
      release.resolve();
      const next = await write;
      expect(await (kind === "settings" ? store.readSettings() : store.readOAuth())).toEqual(next);
    },
  );
});

describe("SQLite process coordination", () => {
  test.each([false, true])(
    "excludes another process on first use and retained DB (retained=%s)",
    async (retained) => {
      if (retained) await createStateStore().updateOAuth(async () => null);
      const a = worker("lock"),
        b = worker("lock");
      await Promise.all([a.wait("ready"), b.wait("ready")]);
      a.child.send("start");
      b.child.send("start");
      await vi.waitFor(() =>
        expect([a, b].filter((w) => w.messages.includes("entered"))).toHaveLength(1),
      );
      const owner = a.messages.includes("entered") ? a : b;
      const waiter = owner === a ? b : a;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(waiter.messages).not.toContain("entered");
      owner.child.send("release");
      await owner.wait("done");
      await waiter.wait("entered");
      waiter.child.send("release");
      await waiter.wait("done");
      expect((await createStateStore().readOAuth()).revision).toBe(retained ? 3 : 2);
    },
    25_000,
  );
  test("recovers after owner death using the same DB", async () => {
    const owner = worker("lock");
    await owner.wait("ready");
    owner.child.send("start");
    await owner.wait("entered");
    const exited = once(owner.child, "exit");
    owner.child.kill("SIGKILL");
    await exited;
    const next = worker("lock");
    await next.wait("ready");
    next.child.send("start");
    await next.wait("entered");
    next.child.send("release");
    await next.wait("done");
    expect((await createStateStore().readOAuth()).revision).toBe(1);
  }, 25_000);
  test("same-process connections retain exclusion across await and leave settings/other directories usable", async () => {
    const store = createStateStore();
    const ready = gate(),
      release = gate();
    const owner = store.updateOAuth(async () => {
      ready.resolve();
      await release.promise;
      return credentials;
    });
    await ready.promise;
    const entered = vi.fn(async () => null);
    const waiter = createStateStore().updateOAuth(entered);
    await store.writeSettings(authenticated);
    expect(await store.readSettings()).toEqual(authenticated);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "other"));
    await createStateStore().updateOAuth(async () => null);
    expect(entered).not.toHaveBeenCalled();
    release.resolve();
    await owner;
    await waiter;
    expect((await store.readOAuth()).revision).toBe(2);
  });
  test("canonical directory aliases share exclusion and cancellation keeps its reason", async () => {
    const store = createStateStore();
    const ready = gate(),
      release = gate();
    const owner = store.updateOAuth(async () => {
      ready.resolve();
      await release.promise;
      return null;
    });
    await ready.promise;
    const alias = join(dir, "alias");
    await fs.symlink(dir, alias, process.platform === "win32" ? "junction" : "dir");
    vi.stubEnv("PI_CODING_AGENT_DIR", alias);
    const controller = new AbortController();
    const entered = vi.fn(async () => null);
    const waiter = createStateStore().updateOAuth(entered, { signal: controller.signal });
    const caught = waiter.catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const reason = { secret: "storage-sentinel" };
    controller.abort(reason);
    expect(await caught).toBe(reason);
    release.resolve();
    await owner;
    expect(entered).not.toHaveBeenCalled();
  });
  test("two process settings writes use successful replacement order", async () => {
    const first = worker("settings", "anonymous-first"),
      second = worker("settings", "authenticated-first");
    await Promise.all([first.wait("ready"), second.wait("ready")]);
    first.child.send("start");
    await first.wait("before-replace");
    second.child.send("start");
    await second.wait("before-replace");
    second.child.send("replace");
    await second.wait("done");
    expect(await createStateStore().readSettings()).toEqual(authenticated);
    first.child.send("replace");
    await first.wait("done");
    expect(await createStateStore().readSettings()).toEqual(defaults);
  }, 25_000);
  test("settings work when SQLite is disabled", async () => {
    const child = worker("no-sqlite", "", dir, ["--no-experimental-sqlite"]);
    await child.wait("ready");
    child.child.send("start");
    await child.wait({ code: "storage" });
    await child.wait("done");
    expect(await createStateStore().readSettings()).toEqual(authenticated);
    expect(await fs.readdir(join(dir, "exa-web"))).toEqual(["settings.json"]);
  }, 20_000);
});
