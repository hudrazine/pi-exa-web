import {
  initTheme,
  ToolExecutionComponent,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";
import exaWebExtension, * as publicModule from "../src/index.ts";
import { registerExaWebTools, type ExaWebClient } from "../src/register-tools.ts";

beforeAll(() => {
  initTheme("dark", false);
});

function captureTools(register: CallableFunction): ToolDefinition[] {
  return captureExtension(register).tools;
}

function captureExtension(register: CallableFunction): {
  tools: ToolDefinition[];
  handlers: Map<string, CallableFunction>;
} {
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, CallableFunction>();
  const pi = {
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    on(event: string, handler: CallableFunction) {
      handlers.set(event, handler);
    },
  };

  Reflect.apply(register, undefined, [pi]);
  return { tools, handlers };
}

function requireTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool, `Expected ${name} to be registered`).toBeDefined();
  return tool!;
}

const plainTheme = {
  fg(_color: string, text: string) {
    return text;
  },
  bold(text: string) {
    return text;
  },
};

function renderCall(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): string {
  const renderer: unknown = Reflect.get(tool, "renderCall");
  expect(renderer).toBeTypeOf("function");
  if (typeof renderer !== "function") {
    return "";
  }

  const component: unknown = Reflect.apply(renderer, tool, [
    args,
    plainTheme,
    {
      args,
      executionStarted: false,
      isPartial: true,
      expanded: false,
      argsComplete: true,
      ...overrides,
    },
  ]);
  return renderComponent(component);
}

function renderComponent(component: unknown): string {
  const render: unknown =
    typeof component === "object" && component !== null
      ? Reflect.get(component, "render")
      : undefined;
  expect(render).toBeTypeOf("function");
  if (typeof render !== "function") {
    return "";
  }
  const lines: unknown = Reflect.apply(render, component, [500]);
  expect(Array.isArray(lines)).toBe(true);
  return Array.isArray(lines)
    ? lines
        .map((line) => stripTerminalSequences(String(line)).trimEnd())
        .join("\n")
        .trimEnd()
    : "";
}

function renderResult(
  tool: ToolDefinition,
  result: Record<string, unknown>,
  options: { expanded: boolean; isPartial?: boolean; isError?: boolean },
): string {
  const renderer: unknown = Reflect.get(tool, "renderResult");
  expect(renderer).toBeTypeOf("function");
  if (typeof renderer !== "function") {
    return "";
  }

  const component: unknown = Reflect.apply(renderer, tool, [
    result,
    { expanded: options.expanded, isPartial: options.isPartial ?? false },
    plainTheme,
    {
      args: {},
      executionStarted: true,
      isPartial: options.isPartial ?? false,
      expanded: options.expanded,
      argsComplete: true,
      isError: options.isError ?? false,
    },
  ]);
  return renderComponent(component);
}

describe("pi-exa-web extension contract", () => {
  test("exports only the default Pi extension and registers two web tools plus shutdown", () => {
    const { tools, handlers } = captureExtension(exaWebExtension);

    expect(Object.keys(publicModule)).toEqual(["default"]);
    expect(tools.map((tool) => tool.name)).toEqual(["web_search", "web_fetch"]);
    expect([...handlers.keys()]).toEqual(["session_shutdown"]);
  });

  test("validates the public tool parameter bounds", () => {
    const tools = captureTools(exaWebExtension);
    const search = requireTool(tools, "web_search");
    const fetch = requireTool(tools, "web_fetch");

    expect(Value.Check(search.parameters, { query: "Pi extensions" })).toBe(true);
    expect(Value.Check(search.parameters, { query: "Pi extensions", numResults: 1 })).toBe(true);
    expect(
      Value.Check(search.parameters, {
        query: "Pi extensions",
        numResults: 20,
      }),
    ).toBe(true);
    expect(Value.Check(search.parameters, { query: "Pi extensions", numResults: 0 })).toBe(false);
    expect(
      Value.Check(search.parameters, {
        query: "Pi extensions",
        numResults: 21,
      }),
    ).toBe(false);
    expect(Value.Check(search.parameters, {})).toBe(false);

    expect(Value.Check(fetch.parameters, { url: "https://pi.dev" })).toBe(true);
    expect(
      Value.Check(fetch.parameters, {
        url: "https://pi.dev",
        maxCharacters: 1,
      }),
    ).toBe(true);
    expect(
      Value.Check(fetch.parameters, {
        url: "https://pi.dev",
        maxCharacters: 20_000,
      }),
    ).toBe(true);
    expect(
      Value.Check(fetch.parameters, {
        url: "https://pi.dev",
        maxCharacters: 0,
      }),
    ).toBe(false);
    expect(
      Value.Check(fetch.parameters, {
        url: "https://pi.dev",
        maxCharacters: 20_001,
      }),
    ).toBe(false);
    expect(Value.Check(fetch.parameters, {})).toBe(false);
  });

  test("maps search and fetch calls through the private Exa client", async () => {
    const search = vi
      .fn<ExaWebClient["search"]>()
      .mockResolvedValue({ text: "search result", auth: "anonymous" });
    const fetch = vi
      .fn<ExaWebClient["fetch"]>()
      .mockResolvedValue({ text: "page result", auth: "api-key" });
    const tools = captureTools((pi: ExtensionAPI) => registerExaWebTools(pi, { search, fetch }));
    const signal = new AbortController().signal;

    const searchTool = requireTool(tools, "web_search");
    const fetchTool = requireTool(tools, "web_fetch");
    const searchResult = await Reflect.apply(Reflect.get(searchTool, "execute"), searchTool, [
      "search-call",
      { query: "Pi extensions", numResults: 5 },
      signal,
      undefined,
      undefined,
    ]);
    const fetchResult = await Reflect.apply(Reflect.get(fetchTool, "execute"), fetchTool, [
      "fetch-call",
      { url: "https://pi.dev", maxCharacters: 4_000 },
      signal,
      undefined,
      undefined,
    ]);

    expect(search).toHaveBeenCalledWith({ query: "Pi extensions", numResults: 5 }, signal);
    expect(searchResult).toEqual({
      content: [{ type: "text", text: "search result" }],
      details: {
        provider: "exa",
        operation: "search",
        auth: "anonymous",
        query: "Pi extensions",
        requestedNumResults: 5,
      },
    });
    expect(fetch).toHaveBeenCalledWith({ url: "https://pi.dev", maxCharacters: 4_000 }, signal);
    expect(fetchResult).toEqual({
      content: [{ type: "text", text: "page result" }],
      details: {
        provider: "exa",
        operation: "fetch",
        auth: "api-key",
        url: "https://pi.dev",
        maxCharacters: 4_000,
      },
    });
  });

  test("renders search and fetch calls with requested limits and pending status", () => {
    const tools = captureTools(exaWebExtension);
    const search = requireTool(tools, "web_search");
    const fetch = requireTool(tools, "web_fetch");

    expect(renderCall(search, { query: "Pi extensions", numResults: 5 })).toBe(
      'web_search "Pi extensions" · requested: 5 results',
    );
    expect(
      renderCall(search, { query: "Pi extensions", numResults: 5 }, { executionStarted: true }),
    ).toBe('web_search "Pi extensions" · requested: 5 results\nSearching…');
    expect(
      renderCall(
        fetch,
        { url: "https://pi.dev", maxCharacters: 4_000 },
        { executionStarted: true },
      ),
    ).toBe("web_fetch https://pi.dev · requested max: 4000 characters\nFetching…");
    expect(renderCall(search, {})).toBe("web_search");
    expect(renderCall(fetch, { url: "https://pi.dev" })).toBe("web_fetch https://pi.dev");
  });

  test("keeps successful results compact until expanded and shows the auth route", () => {
    const tools = captureTools(exaWebExtension);
    const search = requireTool(tools, "web_search");
    const fetch = requireTool(tools, "web_fetch");
    const searchResult = {
      content: [
        {
          type: "text",
          text: "first result\n\u001B]8;;https://unsafe.example\u0007linked result\u001B]8;;\u0007",
        },
      ],
      details: { auth: "anonymous" },
    };

    const collapsed = renderResult(search, searchResult, { expanded: false });
    const expanded = renderResult(search, searchResult, { expanded: true });
    const fetched = renderResult(
      fetch,
      {
        content: [{ type: "text", text: "page body" }],
        details: { auth: "api-key" },
      },
      { expanded: false },
    );

    expect(collapsed).toContain("✓ Search complete · anonymous");
    expect(collapsed).toContain("to view result");
    expect(collapsed).not.toContain("first result");
    expect(expanded).toBe("✓ Search complete · anonymous\nfirst result\nlinked result");
    expect(fetched).toContain("✓ Fetch complete · API key");
    expect(fetched).not.toContain("page body");
  });

  test("renders concise errors, expanded safe detail, cancellation, and missing text", () => {
    const search = requireTool(captureTools(exaWebExtension), "web_search");
    const errorResult = {
      content: [
        {
          type: "text",
          text: "network \u001B[31mfailed\u001B[0m\r\nrequest detail",
        },
      ],
    };

    expect(renderResult(search, errorResult, { expanded: false, isError: true })).toBe(
      "Error: network failed",
    );
    expect(renderResult(search, errorResult, { expanded: true, isError: true })).toBe(
      "Error\nnetwork failed\nrequest detail",
    );
    expect(
      renderResult(
        search,
        { content: [{ type: "text", text: "Operation aborted" }] },
        { expanded: false, isError: true },
      ),
    ).toBe("Cancelled");
    expect(renderResult(search, { content: [] }, { expanded: false, isError: true })).toBe(
      "Error: Web operation failed",
    );
    const longError = "failure ".repeat(30).trim();
    const collapsedLongError = renderResult(
      search,
      { content: [{ type: "text", text: longError }] },
      { expanded: false, isError: true },
    );
    expect(collapsedLongError).toContain("…");
    expect(collapsedLongError).not.toContain(longError);

    const rateLimit =
      "Exa anonymous MCP rate limit reached. Set EXA_API_KEY from https://dashboard.exa.ai/api-keys or retry later.";
    expect(
      renderResult(
        search,
        { content: [{ type: "text", text: rateLimit }] },
        { expanded: false, isError: true },
      ),
    ).toContain(rateLimit);
  });

  test("truncates long call values only while collapsed", () => {
    const tools = captureTools(exaWebExtension);
    const search = requireTool(tools, "web_search");
    const fetch = requireTool(tools, "web_fetch");
    const query = `multi line\n${"query".repeat(30)}`;
    const url = `https://example.com/${"path/".repeat(30)}`;

    const collapsedQuery = renderCall(search, { query });
    const expandedQuery = renderCall(search, { query }, { expanded: true });
    const collapsedUrl = renderCall(fetch, { url });
    const expandedUrl = renderCall(fetch, { url }, { expanded: true });

    expect(collapsedQuery).toContain("multi line query");
    expect(collapsedQuery).toContain("…");
    expect(collapsedQuery).not.toContain(query);
    expect(expandedQuery).toContain(query);
    expect(collapsedUrl).toContain("…");
    expect(collapsedUrl).not.toContain(url);
    expect(expandedUrl).toContain(url);
  });

  test("normalizes only aborted execution errors", async () => {
    const abortReason = new Error("SDK-specific abort detail");
    const otherError = new Error("network unavailable");
    const controller = new AbortController();
    const abortedSearch = vi.fn<ExaWebClient["search"]>().mockImplementation(() => {
      controller.abort();
      return Promise.reject(abortReason);
    });
    const failedSearch = vi.fn<ExaWebClient["search"]>().mockRejectedValue(otherError);
    const unusedFetch = vi.fn<ExaWebClient["fetch"]>();
    const abortedTool = requireTool(
      captureTools((pi: ExtensionAPI) =>
        registerExaWebTools(pi, { search: abortedSearch, fetch: unusedFetch }),
      ),
      "web_search",
    );
    const failedTool = requireTool(
      captureTools((pi: ExtensionAPI) =>
        registerExaWebTools(pi, { search: failedSearch, fetch: unusedFetch }),
      ),
      "web_search",
    );

    await expect(executeTool(abortedTool, { query: "cancel" }, controller.signal)).rejects.toThrow(
      "Operation aborted",
    );
    await expect(executeTool(failedTool, { query: "fail" }, undefined)).rejects.toBe(otherError);
  });

  test("renders pending, collapsed, expanded, and error states through Pi's component", () => {
    const search = requireTool(captureTools(exaWebExtension), "web_search");
    const component: unknown = Reflect.construct(ToolExecutionComponent, [
      "web_search",
      "call-1",
      { query: "Pi extensions", numResults: 5 },
      undefined,
      search,
      { requestRender() {} },
      process.cwd(),
    ]);

    invokeComponent(component, "markExecutionStarted");
    expect(renderComponent(component)).toContain("Searching…");

    invokeComponent(component, "updateResult", {
      content: [{ type: "text", text: "first result\nsecond result" }],
      details: { auth: "anonymous" },
      isError: false,
    });
    expect(renderComponent(component)).toContain("✓ Search complete · anonymous");
    expect(renderComponent(component)).not.toContain("first result");

    invokeComponent(component, "setExpanded", true);
    expect(renderComponent(component)).toContain("first result");
    expect(renderComponent(component)).toContain("second result");

    invokeComponent(component, "updateResult", {
      content: [{ type: "text", text: "request failed" }],
      isError: true,
    });
    expect(renderComponent(component)).toContain("Error");
    expect(renderComponent(component)).toContain("request failed");
  });

  test("can shut down before the lazy MCP connection starts", async () => {
    const { handlers } = captureExtension(exaWebExtension);
    const shutdown = handlers.get("session_shutdown");

    expect(shutdown).toBeDefined();
    await expect(Reflect.apply(shutdown!, undefined, [])).resolves.toBeUndefined();
  });
});

function executeTool(
  tool: ToolDefinition,
  parameters: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  return Reflect.apply(Reflect.get(tool, "execute"), tool, [
    "call",
    parameters,
    signal,
    undefined,
    undefined,
  ]);
}

function invokeComponent(component: unknown, method: string, ...args: unknown[]): void {
  if (typeof component !== "object" || component === null) {
    throw new Error("Expected a Pi component");
  }
  const callable: unknown = Reflect.get(component, method);
  if (typeof callable !== "function") {
    throw new Error(`Expected component method ${method}`);
  }
  Reflect.apply(callable, component, args);
}
