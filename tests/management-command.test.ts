import {
  discoverAndLoadExtensions,
  initTheme,
  SessionManager,
  type BorderedLoader,
} from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createExaMcpClient } from "../src/exa-mcp-client.ts";
import { createStateStore } from "../src/state-store.ts";
import { credentials } from "./fixtures/oauth-state.ts";
import { deferred } from "./fixtures/oauth-server.ts";
import { forwardLogin, loginServer } from "./fixtures/login-server.ts";

let directory: string;
const closes: (() => Promise<void>)[] = [];
const nativeFetch = globalThis.fetch;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "pi-exa-management-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  vi.stubEnv("EXA_API_KEY", "");
  initTheme("dark", false);
});
afterEach(async () => {
  for (const close of closes.splice(0).toReversed()) await close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});
async function load() {
  const loaded = await discoverAndLoadExtensions([resolve("src/index.ts")], directory, directory);
  expect(loaded.errors).toEqual([]);
  const extension = loaded.extensions[0];
  expect([...extension.commands.keys()]).toEqual(["exa"]);
  expect([...extension.tools.keys()]).toEqual(["web_search", "web_fetch"]);
  expect([...extension.handlers.keys()]).toEqual(["session_shutdown"]);
  const notify = vi.fn();
  let component: BorderedLoader | undefined;
  const custom = vi.fn(
    (factory) =>
      new Promise((resolveResult) => {
        component = Reflect.apply(factory, undefined, [
          { requestRender() {} },
          { fg: (_color: string, text: string) => text },
          {},
          (value: unknown) => {
            component?.dispose();
            resolveResult(value);
          },
        ]);
      }),
  );
  const close = async () => {
    for (const handler of extension.handlers.get("session_shutdown")!)
      await Reflect.apply(handler, undefined, [{ type: "session_shutdown" }, {}]);
  };
  closes.push(close);
  return {
    notify,
    custom,
    extension,
    close,
    component: () => component!,
    command: (args: string, mode = "tui", signal?: AbortSignal): Promise<void> =>
      Reflect.apply(extension.commands.get("exa")!.handler, undefined, [
        args,
        { mode, hasUI: mode === "tui" || mode === "rpc", signal, ui: { notify, custom } },
      ]),
  };
}

test("registered command completes arguments without executing management operations", async () => {
  const { extension, notify, custom } = await load();
  const fetch = vi.spyOn(globalThis, "fetch");
  const spawn = vi.spyOn(childProcess, "spawn");
  const readFile = vi.spyOn(fs, "readFile");
  const rename = vi.spyOn(fs, "rename");
  const command = extension.commands.get("exa")!;
  const complete = command.getArgumentCompletions!;
  const cases: [string, string[] | null][] = [
    ["", ["login", "logout", "status", "strategy"]],
    ["   ", ["login", "logout", "status", "strategy"]],
    ["lo", ["login", "logout"]],
    ["st", ["status", "strategy"]],
    ["  lo", ["login", "logout"]],
    ["login", ["login"]],
    ["strategy", ["strategy"]],
    ["strategy ", ["strategy anonymous-first", "strategy authenticated-first"]],
    ["strategy au", ["strategy authenticated-first"]],
    ["strategy an", ["strategy anonymous-first"]],
    ["  strategy   au", ["strategy authenticated-first"]],
    ["strategy authenticated-first", ["strategy authenticated-first"]],
    ["strategy anonymous-first", ["strategy anonymous-first"]],
    ["login ", null],
    ["logout ", null],
    ["status ", null],
    ["LOGIN", null],
    ["Strategy ", null],
    ["strategy AU", null],
    ["unknown", null],
    ["strategy unknown", null],
    ["strategy anonymous-first ", null],
    ["strategy anonymous-first extra", null],
  ];
  for (const [prefix, expected] of cases) {
    const result = await complete(prefix);
    expect(result?.map((item) => item.value) ?? null, prefix).toEqual(expected);
    for (const item of result ?? []) {
      expect(item.label).toBe(item.value.split(" ").at(-1));
      expect(item.description).toEqual(expect.any(String));
      expect(item.description!.length).toBeGreaterThan(0);
    }
  }
  const descriptions = await complete("");
  expect(descriptions![0].description).toContain("interactive Pi");
  expect(descriptions![1].description).toContain("local");
  expect(descriptions![2].description).toContain("local");

  const provider = new CombinedAutocompleteProvider([command], directory);
  const input = "/exa strategy au";
  const suggestions = await provider.getSuggestions([input], 0, input.length, {
    signal: new AbortController().signal,
  });
  expect(suggestions?.items).toHaveLength(1);
  const applied = provider.applyCompletion(
    [input],
    0,
    input.length,
    suggestions!.items[0],
    suggestions!.prefix,
  );
  expect(applied.lines).toEqual(["/exa strategy authenticated-first"]);
  expect(applied.cursorCol).toBe(applied.lines[0].length);
  expect(notify).not.toHaveBeenCalled();
  expect(custom).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  expect(rename).not.toHaveBeenCalled();
  expect(await fs.readdir(directory)).not.toContain("exa-web");
});

test.each(["rpc", "json", "print"])(
  "%s login gives local TUI guidance without starting UI, browser, listener or network",
  async (mode) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network"));
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      throw new Error("unexpected browser");
    });
    const { command, custom, notify } = await load();
    await command("login", mode);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Run /exa login in a local interactive Pi using the same agent directory.",
      "info",
    );
    expect(custom).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).not.toContain("exa-web");
  },
);

test.each([false, true])(
  "status reads all local states with startup key=%s and performs no writes or communication",
  async (key) => {
    const store = createStateStore();
    const client = createExaMcpClient({ apiKey: key ? " key-sentinel " : " " });
    closes.push(() => client.close());
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network"));
    const initial = await client.getStatus();
    expect(initial).toEqual({
      strategy: "anonymous-first",
      oauth: "unconfigured",
      apiKey: key,
      authentication: key ? "api-key" : "unavailable",
    });
    expect(await fs.readdir(directory)).toEqual([]);
    for (const mode of ["valid", "no-expiry", "expired", "no-refresh", "login-required"]) {
      const saved = structuredClone(credentials);
      saved.expiresAt = ["expired", "no-refresh"].includes(mode) ? Date.now() : Date.now() + 60_000;
      if (mode === "no-expiry") {
        delete saved.expiresAt;
        delete saved.tokens.expires_in;
      }
      if (mode === "no-refresh") delete saved.tokens.refresh_token;
      if (mode === "login-required") saved.loginRequired = true;
      await store.updateOAuth(async () => saved);
      const before = await fs.readFile(join(directory, "exa-web/oauth.json"), "utf8");
      const status = await client.getStatus();
      expect(status).toMatchObject({
        oauth:
          mode === "expired"
            ? "expired-refreshable"
            : ["no-refresh", "login-required"].includes(mode)
              ? "login-required"
              : "locally-available",
        authentication: ["no-refresh", "login-required"].includes(mode)
          ? key
            ? "api-key"
            : "unavailable"
          : "oauth",
      });
      expect(inspect(status)).not.toContain("sentinel");
      expect(await fs.readFile(join(directory, "exa-web/oauth.json"), "utf8")).toBe(before);
    }
    await client.close();
    await expect(client.getStatus()).rejects.toMatchObject({ code: "lifecycle" });
    await expect(client.login(() => {})).rejects.toMatchObject({ code: "lifecycle" });
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("status and logout notifications contain only safe state; logout notifies after commit and retains strategy/key", async () => {
  vi.stubEnv("EXA_API_KEY", "key-sentinel");
  const store = createStateStore();
  await store.writeSettings({ version: 1, strategy: "authenticated-first" });
  await store.updateOAuth(async () => credentials);
  const { command, notify } = await load();
  await command("status");
  expect(notify.mock.calls[0][0]).toContain("OAuth: locally available");
  expect(notify.mock.calls[0][0]).toContain("API key: configured");
  expect(notify.mock.calls[0][0]).toContain("Local authentication candidate: oauth");
  const entered = deferred(),
    release = deferred();
  const rename = fs.rename;
  vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return rename(...args);
  });
  notify.mockClear();
  const pending = command("logout");
  await entered.promise;
  expect(notify).not.toHaveBeenCalled();
  release.resolve();
  await pending;
  expect(notify).toHaveBeenCalledExactlyOnceWith("Exa OAuth credentials removed locally.", "info");
  expect(await store.readOAuth()).toEqual({ version: 1, revision: 2, credentials: null });
  await command("status");
  expect(notify.mock.lastCall![0]).toContain("Exa strategy: authenticated-first");
  expect(notify.mock.lastCall![0]).toContain("Local authentication candidate: api-key");
  expect(inspect(notify.mock.calls)).not.toContain("sentinel");
});

test.each([
  "success",
  "denied",
  "conflict",
  "rename",
  "cancel",
  "dispose",
  "shutdown",
  "timeout",
  "caller",
])(
  "real Pi login %s clears its transient URL, hides secrets and reports only the committed result",
  async (mode) => {
    const server = await loginServer((request) =>
      request.message.method === "tools/call"
        ? {
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `${request.message.params?.name} error (429): login-sentinel`,
                },
              ],
            },
          }
        : undefined,
    );
    closes.push(() => server.close());
    vi.stubGlobal("fetch", forwardLogin(server.origin, nativeFetch));
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    let shown!: (url: URL) => void;
    const authorization = new Promise<URL>((ready) => {
      shown = ready;
    });
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation((_command, args) => {
      const argument = args?.at(-1);
      if (typeof argument !== "string") throw new Error("Missing browser URL");
      shown(new URL(argument));
      throw new Error("login-sentinel browser unavailable", { cause: "login-sentinel" });
    });
    const ui = await load();
    const caller = new AbortController();
    let expire: (() => void) | undefined;
    if (mode === "timeout") {
      const setTimer = globalThis.setTimeout;
      vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, milliseconds, ...args) => {
        if (milliseconds === 300_000) expire = () => callback(...args);
        return setTimer(callback, milliseconds, ...args);
      });
    }
    const session = SessionManager.create(directory, directory);
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Management fixture" }],
      api: "openai-completions",
      provider: "openai",
      model: "fixture",
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const operation = ui.command("login", "tui", caller.signal);
    const url = await authorization;
    expect(ui.component().render(5_000).join("\n")).toContain(url.href);
    expect(spawn.mock.calls[0][2]).toEqual({ shell: false, stdio: "ignore", detached: true });
    expect(spawn.mock.calls[0].slice(0, 2)).toEqual(
      process.platform === "darwin"
        ? ["open", [url.href]]
        : process.platform === "win32"
          ? ["rundll32", ["url.dll,FileProtocolHandler", url.href]]
          : ["xdg-open", [url.href]],
    );
    await ui.command("login");
    expect(ui.custom).toHaveBeenCalledTimes(1);
    expect(ui.notify).toHaveBeenLastCalledWith("Exa login is already in progress.", "error");
    ui.notify.mockClear();
    const callback = server.callbackURL(url);
    const store = createStateStore();
    if (mode === "cancel") ui.component().handleInput("\x1b");
    else if (mode === "dispose") ui.component().dispose();
    else if (mode === "shutdown") await ui.close();
    else if (mode === "timeout") {
      expect(expire).toBeTypeOf("function");
      expire!();
    } else if (mode === "caller")
      caller.abort(new Error("login-sentinel", { cause: "login-sentinel" }));
    else {
      if (mode === "denied") {
        callback.searchParams.delete("code");
        callback.searchParams.set("error", "access_denied");
        callback.searchParams.set("error_description", "login-sentinel");
      }
      if (mode === "conflict") await store.updateOAuth(async () => null);
      const entered = deferred(),
        release = deferred();
      const rename = fs.rename;
      const replacing = vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
        entered.resolve();
        await release.promise;
        if (mode === "rename") throw new Error("login-sentinel", { cause: "login-sentinel" });
        return rename(...args);
      });
      await nativeFetch(callback);
      if (mode === "success" || mode === "rename") {
        await entered.promise;
        expect(ui.notify).not.toHaveBeenCalled();
        expect((await store.readOAuth()).revision).toBe(0);
      }
      release.resolve();
      await operation;
      replacing.mockRestore();
    }
    await operation;
    expect(ui.component().render(5_000).join("\n")).not.toContain(url.href);
    const messages: Record<string, string> = {
      success: "Exa login saved.",
      denied: "Exa login was denied.",
      conflict: "Exa credentials changed. Start login again.",
      rename: "Could not read or save Exa settings or credentials.",
      cancel: "Exa login cancelled.",
      dispose: "Exa login cancelled.",
      shutdown: "pi-exa-web MCP client is closed",
      timeout: "Exa login timed out. Start login again.",
      caller: "Exa login cancelled.",
    };
    expect(ui.notify).toHaveBeenCalledExactlyOnceWith(
      messages[mode],
      mode === "success" ? "info" : "error",
    );
    for (const name of ["web_search", "web_fetch"]) {
      const tool = ui.extension.tools.get(name)!.definition;
      let failure: unknown;
      try {
        await Reflect.apply(Reflect.get(tool, "execute"), tool, [
          "fixture",
          name === "web_search" ? { query: "q" } : { url: "https://example.com" },
          undefined,
          undefined,
          {},
        ]);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw new Error("Expected safe failure");
      expect(inspect(failure, { depth: 20, showHidden: true })).not.toContain("sentinel");
      session.appendMessage({
        role: "toolResult",
        toolCallId: "fixture",
        toolName: name,
        content: [{ type: "text", text: failure.message }],
        details: {},
        isError: true,
        timestamp: Date.now(),
      });
    }
    const records = await fs.readFile(session.getSessionFile()!, "utf8");
    const boundary =
      inspect([ui.notify.mock.calls, logs.map((log) => log.mock.calls)], { depth: 20 }) + records;
    for (const secret of [
      "login-sentinel",
      url.href,
      url.searchParams.get("state")!,
      url.searchParams.get("code_challenge")!,
      ...server.requests.flatMap((request) =>
        request.form.has("code_verifier") ? [request.form.get("code_verifier")!] : [],
      ),
    ])
      expect(boundary).not.toContain(secret);
  },
);
