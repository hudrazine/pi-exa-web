import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createOAuthState, OAuthUnavailableError } from "../src/oauth-state.ts";
import { createStateStore } from "../src/state-store.ts";
import { credentials } from "./fixtures/oauth-state.ts";
import { deferred, forwardOAuth, oauthServer } from "./fixtures/oauth-server.ts";

let directory: string;
let store: ReturnType<typeof createStateStore>;
const servers: Awaited<ReturnType<typeof oauthServer>>[] = [];
const signal = new AbortController().signal;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "pi-exa-refresh-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  store = createStateStore();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await fs.rm(directory, { recursive: true, force: true });
});
async function setup(handler?: Parameters<typeof oauthServer>[0]) {
  const server = await oauthServer(handler);
  servers.push(server);
  return { server, manager: createOAuthState(store, forwardOAuth(server.origin)) };
}

test("refresh commits rotated tokens, preserves issuer bindings, and uses the committed revision", async () => {
  await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const { manager, server } = await setup();
  const before = Date.now();
  const next = await manager.resolve(signal);
  expect(next?.revision).toBe(2);
  expect(next?.credentials?.tokens).toMatchObject({
    access_token: "access-1",
    refresh_token: "refresh-1",
    issuer: credentials.tokens.issuer,
  });
  expect(next?.credentials?.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
  expect(next?.credentials?.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
  expect(next?.credentials?.discovery).toEqual(credentials.discovery);
  expect(await store.readOAuth()).toEqual(next);
  expect(await manager.refresh(1, signal)).toEqual(next);
  expect(server.requests).toHaveLength(1);
  const request = server.requests[0];
  expect(request.path).toBe("/token");
  expect(Object.fromEntries(request.form)).toMatchObject({
    grant_type: "refresh_token",
    resource: credentials.resource,
    client_id: "client-id",
    refresh_token: credentials.tokens.refresh_token,
  });
  expect(request.headers["x-api-key"]).toBeUndefined();
});

test("omitted refresh token survives but omitted expiry clears the old absolute deadline", async () => {
  await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const { manager } = await setup(() => ({ json: { access_token: "new", token_type: "Bearer" } }));
  const next = await manager.resolve(signal);
  expect(next?.credentials?.tokens.refresh_token).toBe(credentials.tokens.refresh_token);
  expect(next?.credentials).not.toHaveProperty("expiresAt");
  expect(next?.credentials?.tokens).not.toHaveProperty("expires_in");
});

test.each(["invalid_grant", "invalid_client", "unauthorized_client"])(
  "%s persists login-required exactly once",
  async (error) => {
    await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
    const { manager, server } = await setup(() => ({
      status: 400,
      json: { error, error_description: "secret-sentinel" },
    }));
    await expect(manager.resolve(signal)).rejects.toMatchObject({ code: "authentication" });
    expect(await store.readOAuth()).toMatchObject({
      revision: 2,
      credentials: { loginRequired: true },
    });
    await expect(manager.resolve(signal)).resolves.toBeUndefined();
    await expect(manager.refresh(1, signal)).rejects.toMatchObject({ code: "authentication" });
    expect((await store.readOAuth()).revision).toBe(2);
    expect(server.requests).toHaveLength(1);
  },
);

test.each([429, 500, 503, "network", "body"])(
  "%s allows later retry without invalidation",
  async (status) => {
    const original = await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
    let failing = true;
    const { manager, server } = await setup(() =>
      failing
        ? typeof status === "number"
          ? { status }
          : status === "body"
            ? { truncate: true }
            : { disconnect: true }
        : undefined,
    );
    await expect(manager.resolve(signal)).rejects.toBeInstanceOf(OAuthUnavailableError);
    expect(await store.readOAuth()).toEqual(original);
    failing = false;
    expect((await manager.resolve(signal))?.revision).toBe(2);
    expect(server.requests).toHaveLength(2);
  },
);

test("invalid token responses are terminal transport failures without alternate eligibility", async () => {
  const original = await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const { manager } = await setup(() => ({ json: { unexpected: "secret-sentinel" } }));
  const error = await manager.resolve(signal).catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: "transport" });
  expect(error).not.toBeInstanceOf(OAuthUnavailableError);
  expect(await store.readOAuth()).toEqual(original);
});

test.each(["write", "rename"])(
  "rotation followed by %s failure preserves old state and surfaces storage",
  async (failure) => {
    const original = await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
    const { manager, server } = await setup();
    if (failure === "rename")
      vi.spyOn(fs, "rename").mockRejectedValue(new Error("secret-sentinel"));
    else {
      const open = fs.open;
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await open(...args);
        vi.spyOn(handle, "writeFile").mockRejectedValue(new Error("secret-sentinel"));
        return handle;
      });
    }
    await expect(manager.resolve(signal)).rejects.toMatchObject({ code: "storage" });
    expect(await store.readOAuth()).toEqual(original);
    expect(server.requests).toHaveLength(1);
    expect(
      (await fs.readdir(join(directory, "exa-web"))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  },
);

test.each(["rollback", "close"])(
  "refresh authentication failure yields to %s storage failure",
  async (failure) => {
    await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
    const { DatabaseSync } = await import("node:sqlite");
    const { manager } = await setup(() => ({ status: 400, json: { error: "invalid_grant" } }));
    if (failure === "rollback") {
      // eslint-disable-next-line typescript/unbound-method -- The receiver is supplied with call below.
      const exec = DatabaseSync.prototype.exec;
      vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(
        function (this: InstanceType<typeof DatabaseSync>, sql) {
          if (sql.toUpperCase().includes("ROLLBACK")) throw new Error("secret-sentinel");
          return exec.call(this, sql);
        },
      );
    } else {
      // eslint-disable-next-line typescript/unbound-method -- The receiver is supplied with call below.
      const close = DatabaseSync.prototype.close;
      vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(
        function (this: InstanceType<typeof DatabaseSync>) {
          close.call(this);
          throw new Error("secret-sentinel");
        },
      );
    }
    await expect(manager.resolve(signal)).rejects.toMatchObject({ code: "storage" });
    expect((await store.readOAuth()).credentials?.loginRequired).toBe(true);
    vi.restoreAllMocks();
    await manager.logout(signal);
  },
);

test("refresh holds ownership across HTTP; logout wins afterward and stale 401 cannot resurrect it", async () => {
  await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const entered = deferred();
  const release = deferred();
  const { manager, server } = await setup(async () => {
    entered.resolve();
    await release.promise;
    return undefined;
  });
  const refreshing = manager.resolve(signal);
  await entered.promise;
  const logout = manager.logout(signal);
  await store.writeSettings({ version: 1, strategy: "authenticated-first" });
  expect((await store.readOAuth()).revision).toBe(1);
  release.resolve();
  await refreshing;
  await expect(logout).resolves.toEqual({ version: 1, revision: 3, credentials: null });
  await expect(manager.refresh(1, signal)).rejects.toMatchObject({ code: "authentication" });
  expect(server.requests).toHaveLength(1);
});

test("caller abort interrupts refresh, releases ownership, and retains the original reason", async () => {
  const original = await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const entered = deferred();
  const release = deferred();
  const { manager } = await setup(async () => {
    entered.resolve();
    await release.promise;
    return undefined;
  });
  const controller = new AbortController();
  const reason = new Error("secret-sentinel");
  const pending = manager.resolve(controller.signal);
  await entered.promise;
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(await store.readOAuth()).toEqual(original);
  await manager.logout(signal);
  release.resolve();
});
