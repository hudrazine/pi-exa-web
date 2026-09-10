import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createStateStore } from "../src/state-store.ts";
import { credentials } from "./fixtures/oauth-state.ts";
import { loginServer } from "./fixtures/login-server.ts";

const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }),
  );
  vi.unstubAllEnvs();
});
function worker(origin: string, directory: string, mode: string) {
  const child = fork(new URL("./fixtures/login-worker.ts", import.meta.url), [origin, mode], {
    execArgv: [],
    env: { ...process.env, PI_CODING_AGENT_DIR: directory },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  const messages: { kind: string; url?: string; code?: string }[] = [];
  let stderr = "";
  child.stderr!.on("data", (data) => {
    stderr += String(data);
  });
  child.on("message", (message) => {
    if (
      message !== null &&
      typeof message === "object" &&
      "kind" in message &&
      typeof message.kind === "string"
    ) {
      messages.push({
        kind: message.kind,
        ...("url" in message && typeof message.url === "string" ? { url: message.url } : {}),
        ...("code" in message && typeof message.code === "string" ? { code: message.code } : {}),
      });
    }
  });
  return {
    child,
    async wait(kind: string) {
      await vi.waitFor(
        () => {
          expect(child.exitCode, stderr).not.toBe(1);
          expect(messages.some((message) => message.kind === kind)).toBe(true);
        },
        { timeout: 15_000, interval: 10 },
      );
      return messages.find((message) => message.kind === kind)!;
    },
  };
}

test.each(["login", "refresh", "logout"])(
  "another process's %s commit wins over an earlier interactive login",
  async (mode) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "pi-exa-login-process-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", directory);
    const store = createStateStore();
    await store.writeSettings({ version: 1, strategy: "authenticated-first" });
    await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
    const server = await loginServer();
    try {
      const login = worker(server.origin, directory, "login");
      const other = worker(server.origin, directory, mode);
      await Promise.all([login.wait("ready"), other.wait("ready")]);
      login.child.send("start");
      const authorization = new URL((await login.wait("authorization")).url!);
      other.child.send("start");
      if (mode === "login")
        await fetch(server.callbackURL(new URL((await other.wait("authorization")).url!)));
      expect((await other.wait("result")).code).toBe("success");
      const committed = await store.readOAuth();
      expect(committed.revision).toBe(2);
      await store.writeSettings({ version: 1, strategy: "anonymous-first" });
      await fetch(server.callbackURL(authorization));
      expect((await login.wait("result")).code).toBe("storage-conflict");
      expect(await store.readOAuth()).toEqual(committed);
      expect((await store.readSettings()).strategy).toBe("anonymous-first");
      expect(
        server.requests.filter((request) => request.form.get("grant_type") === "refresh_token"),
      ).toHaveLength(mode === "refresh" ? 1 : 0);
    } finally {
      await server.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
  25_000,
);
