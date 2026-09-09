import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import {
  discoverAndLoadExtensions,
  SessionManager,
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vite-plus/test";
import { createStateStore } from "../src/state-store.ts";
import { credentials } from "./fixtures/oauth-state.ts";
import { forwardOAuth, oauthServer, type OAuthReply } from "./fixtures/oauth-server.ts";

test("real Pi loader conceals OAuth tokens, challenges, refresh/storage failures and causes in errors, display, logs and sessions", async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "pi-exa-oauth-boundary-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  vi.stubEnv("EXA_API_KEY", "");
  const store = createStateStore();
  await store.writeSettings({ version: 1, strategy: "authenticated-first" });
  const sentinel = "boundary-secret-sentinel";
  let mode = "tool";
  const server = await oauthServer((request): OAuthReply | undefined => {
    if (request.path === "/token") {
      if (mode === "refresh-auth")
        return { status: 400, json: { error: "invalid_grant", error_description: sentinel } };
      if (mode === "refresh-storage")
        return {
          status: 200,
          json: {
            access_token: sentinel,
            refresh_token: sentinel,
            token_type: "Bearer",
            expires_in: 3600,
          },
        };
      return { status: 503, json: { secret: sentinel } };
    }
    if (request.message.method !== "tools/call") return undefined;
    if (
      ["refresh-auth", "refresh-network", "refresh-storage", "challenge"].includes(mode) &&
      request.path === "/mcp/oauth"
    )
      return {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="https://user:${sentinel}@example.com/?token=${sentinel}"`,
        },
      };
    if (mode === "tool")
      return {
        result: {
          isError: true,
          content: [
            { type: "text", text: `${request.message.params?.name} error (429): ${sentinel}` },
          ],
        },
      };
    return {
      status: 500,
      headers: { "x-private": sentinel },
      json: { cause: { authorization: sentinel } },
    };
  });
  const forwarded = forwardOAuth(server.origin);
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (mode === "network" && typeof init?.body === "string" && init.body.includes("tools/call"))
      throw new TypeError(`https://user:${sentinel}@example.com`, {
        cause: { nested: new Error(sentinel) },
      });
    return forwarded(input, init);
  });
  const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  const loaded = await discoverAndLoadExtensions([resolve("src/index.ts")], directory, directory);
  try {
    expect(loaded.errors).toEqual([]);
    const extension = loaded.extensions[0];
    expect([...extension.tools.keys()]).toEqual(["web_search", "web_fetch"]);
    expect([...extension.commands.keys()]).toEqual(["exa"]);
    expect([...extension.handlers.keys()]).toEqual(["session_shutdown"]);
    expect(server.requests).toEqual([]);
    initTheme("dark", false);
    const session = SessionManager.create(directory, directory);
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "OAuth fixture" }],
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
    for (const name of ["web_search", "web_fetch"]) {
      const tool = extension.tools.get(name)!.definition;
      const args = name === "web_search" ? { query: "fixture" } : { url: "https://example.com" };
      for (mode of [
        "tool",
        "network",
        "challenge",
        "refresh-auth",
        "refresh-network",
        "refresh-storage",
        "abort",
      ]) {
        await store.updateOAuth(async () => ({
          ...credentials,
          tokens: { ...credentials.tokens, access_token: sentinel, refresh_token: sentinel },
          clientInformation: { ...credentials.clientInformation, client_secret: sentinel },
        }));
        const rename =
          mode === "refresh-storage"
            ? vi
                .spyOn(fs, "rename")
                .mockRejectedValue(new Error(sentinel, { cause: { path: sentinel } }))
            : undefined;
        const controller = new AbortController();
        if (mode === "abort") controller.abort(new Error(sentinel, { cause: sentinel }));
        let failure: unknown;
        try {
          await Reflect.apply(Reflect.get(tool, "execute"), tool, [
            "oauth-fixture",
            args,
            controller.signal,
            undefined,
            {},
          ]);
        } catch (error) {
          failure = error;
        } finally {
          rename?.mockRestore();
        }
        expect(failure).toBeInstanceOf(Error);
        if (!(failure instanceof Error)) throw new Error("Expected tool failure");
        expect(inspect(failure, { depth: 20, showHidden: true })).not.toContain(sentinel);
        expect(failure).not.toHaveProperty("cause");
        const result = {
          content: [{ type: "text" as const, text: failure.message }],
          details: {},
          isError: true,
        };
        session.appendMessage({
          role: "toolResult",
          toolCallId: "oauth-fixture",
          toolName: name,
          ...result,
          timestamp: Date.now(),
        });
        const component: ToolExecutionComponent = Reflect.construct(ToolExecutionComponent, [
          name,
          "oauth-fixture",
          args,
          undefined,
          tool,
          { requestRender() {} },
          directory,
        ]);
        component.updateResult(result);
        for (const expanded of [false, true]) {
          component.setExpanded(expanded);
          const rendered = component.render(500).join("\n");
          expect(rendered).not.toContain(sentinel);
          expect(rendered).toContain(mode === "abort" ? "Cancelled" : "Error");
        }
      }
    }
    expect(await fs.readFile(session.getSessionFile()!, "utf8")).not.toContain(sentinel);
    expect(
      inspect(
        logs.flatMap((spy) => spy.mock.calls),
        { depth: 20 },
      ),
    ).not.toContain(sentinel);
  } finally {
    for (const extension of loaded.extensions)
      for (const handler of extension.handlers.get("session_shutdown") ?? [])
        await Reflect.apply(handler, undefined, [{ type: "session_shutdown" }, {}]);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
