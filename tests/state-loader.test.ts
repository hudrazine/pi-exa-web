import {
  discoverAndLoadExtensions,
  initTheme,
  SessionManager,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { expect, test, vi } from "vite-plus/test";
import packageJson from "../package.json" with { type: "json" };

test("CI executes the declared OS, architecture and Node runtime", () => {
  if (process.env.PI_EXA_CI_PLATFORM) {
    expect(process.platform).toBe(process.env.PI_EXA_CI_PLATFORM);
    expect(process.arch).toBe(process.env.PI_EXA_CI_ARCH);
    expect(process.versions.node).toBe(
      process.env.PI_EXA_CI_MINIMUM === "true" ? "24.15.0" : packageJson.devEngines.runtime.version,
    );
  } else {
    expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(24);
  }
});

test("Pi loads the package and real SQLite storage; storage secrets never enter errors, rendering, logs or sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-exa-loader-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network request"));
  try {
    const production = await discoverAndLoadExtensions([resolve("src/index.ts")], dir, dir);
    expect(production.errors).toEqual([]);
    expect([...production.extensions[0].tools.keys()]).toEqual(["web_search", "web_fetch"]);
    expect(await readdir(dir)).not.toContain("exa-web");
    const loaded = await discoverAndLoadExtensions(
      [resolve("tests/fixtures/state-extension.ts")],
      dir,
      dir,
    );
    expect(loaded.errors).toEqual([]);
    const extension = loaded.extensions[0];
    const search = extension.tools.get("web_search")!.definition;
    const result = await Reflect.apply(Reflect.get(search, "execute"), search, [
      "fixture",
      { query: "fixture" },
      undefined,
      undefined,
      {},
    ]);
    expect(result.content).toEqual([{ type: "text", text: "1" }]);
    expect(await readdir(join(dir, "exa-web"))).toContain("oauth.lock.sqlite");
    const sentinel = "storage-sentinel";
    await writeFile(
      join(dir, "exa-web", "oauth.json"),
      `{"token":"${sentinel}","cause":{"url":"https://user:${sentinel}@example.test"}}`,
    );
    const session = SessionManager.create(dir, dir);
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Storage fixture calls" }],
      api: "openai-completions",
      provider: "openai",
      model: "fixture",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    initTheme("dark", false);
    for (const name of ["web_search", "web_fetch"]) {
      const tool = extension.tools.get(name)!.definition;
      const args = name === "web_search" ? { query: "fixture" } : { url: "https://example.test" };
      const failure: unknown = await Reflect.apply(Reflect.get(tool, "execute"), tool, [
        "fixture",
        args,
        undefined,
        undefined,
        {},
      ]).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "storage" });
      expect(failure).not.toHaveProperty("cause");
      expect(inspect(failure, { depth: 10, showHidden: true })).not.toContain(sentinel);
      if (!(failure instanceof Error)) throw new Error("Expected storage error");
      const failedResult = {
        content: [{ type: "text" as const, text: failure.message }],
        details: {},
        isError: true,
      };
      session.appendMessage({
        role: "toolResult",
        toolCallId: "fixture",
        toolName: name,
        ...failedResult,
        timestamp: Date.now(),
      });
      const component: ToolExecutionComponent = Reflect.construct(ToolExecutionComponent, [
        name,
        "fixture",
        args,
        undefined,
        tool,
        { requestRender() {} },
        dir,
      ]);
      component.updateResult(failedResult);
      for (const expanded of [false, true]) {
        component.setExpanded(expanded);
        expect(component.render(500).join("\n")).not.toContain(sentinel);
      }
    }
    const records = await readFile(session.getSessionFile()!, "utf8");
    expect(records).toContain("toolResult");
    expect(records).not.toContain(sentinel);
    expect(
      inspect(
        logs.map((log) => log.mock.calls),
        { depth: 10 },
      ),
    ).not.toContain(sentinel);
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
