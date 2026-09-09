import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createStateStore } from "../src/state-store.ts";
import { credentials } from "./fixtures/oauth-state.ts";
import { deferred, oauthServer } from "./fixtures/oauth-server.ts";

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
function worker(origin: string, directory: string) {
  const child = fork(new URL("./fixtures/oauth-worker.ts", import.meta.url), [origin], {
    execArgv: [],
    env: { ...process.env, PI_CODING_AGENT_DIR: directory },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  const messages: unknown[] = [];
  let stderr = "";
  child.stderr!.on("data", (data) => {
    stderr += String(data);
  });
  child.on("message", (message) => messages.push(message));
  return {
    child,
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

test.each(["proactive", "401"])(
  "L4: two real processes share one %s rotating-token refresh",
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-exa-oauth-process-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", directory);
    const store = createStateStore();
    await store.writeSettings({ version: 1, strategy: "authenticated-first" });
    await store.updateOAuth(async () => ({
      ...credentials,
      expiresAt: mode === "proactive" ? 0 : Date.now() + 60_000,
    }));
    const bothRejected = deferred();
    const refreshing = deferred();
    const release = deferred();
    let oldCalls = 0;
    const server = await oauthServer(async (request) => {
      if (request.path === "/token") {
        refreshing.resolve();
        await release.promise;
      }
      if (
        mode === "401" &&
        request.message.method === "tools/call" &&
        request.headers.authorization === `Bearer ${credentials.tokens.access_token}`
      ) {
        if (++oldCalls === 2) bothRejected.resolve();
        await bothRejected.promise;
        return { status: 401 };
      }
      return undefined;
    });
    try {
      const first = worker(server.origin, directory),
        second = worker(server.origin, directory);
      await Promise.all([first.wait("ready"), second.wait("ready")]);
      first.child.send("start");
      second.child.send("start");
      await refreshing.promise;
      expect((await store.readOAuth()).revision).toBe(1);
      await store.writeSettings({ version: 1, strategy: "anonymous-first" });
      release.resolve();
      const expected = { auth: "oauth", text: "first\n\nsecond" };
      await Promise.all([first.wait(expected), second.wait(expected)]);
      expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(1);
      expect(
        server.requests.filter(
          (r) => r.message.method === "tools/call" && r.headers.authorization === "Bearer access-1",
        ),
      ).toHaveLength(2);
      expect((await store.readOAuth()).revision).toBe(2);
    } finally {
      release.resolve();
      bothRejected.resolve();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  25_000,
);
