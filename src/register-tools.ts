import {
  keyHint,
  type AgentToolResult,
  type ExtensionAPI,
  type Theme,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

const searchParameters = Type.Object({
  query: Type.String({ description: "Natural-language web search query" }),
  numResults: Type.Optional(
    Type.Integer({
      description: "Requested number of search results",
      minimum: 1,
      maximum: 20,
    }),
  ),
});

const fetchParameters = Type.Object({
  url: Type.String({ description: "URL of the web page to read" }),
  maxCharacters: Type.Optional(
    Type.Integer({
      description: "Maximum number of characters to return",
      minimum: 1,
      maximum: 20_000,
    }),
  ),
});

type SearchParameters = Static<typeof searchParameters>;
type FetchParameters = Static<typeof fetchParameters>;
type AuthRoute = "anonymous" | "api-key";

interface ExaWebResult {
  text: string;
  auth: AuthRoute;
}

interface SearchDetails {
  provider: "exa";
  operation: "search";
  auth: AuthRoute;
  query: string;
  requestedNumResults?: number;
}

interface FetchDetails {
  provider: "exa";
  operation: "fetch";
  auth: AuthRoute;
  url: string;
  maxCharacters?: number;
}

export interface ExaWebClient {
  search(parameters: SearchParameters, signal: AbortSignal | undefined): Promise<ExaWebResult>;
  fetch(parameters: FetchParameters, signal: AbortSignal | undefined): Promise<ExaWebResult>;
}

export function registerExaWebTools(pi: ExtensionAPI, client: ExaWebClient): void {
  pi.registerTool<typeof searchParameters, SearchDetails>({
    name: "web_search",
    label: "Web Search",
    description: "Search the web for current information.",
    parameters: searchParameters,
    async execute(_toolCallId, parameters, signal) {
      const result = await runToolOperation(signal, () => client.search(parameters, signal));

      return {
        content: [{ type: "text", text: result.text }],
        details: {
          provider: "exa",
          operation: "search",
          auth: result.auth,
          query: parameters.query,
          ...(parameters.numResults === undefined
            ? {}
            : { requestedNumResults: parameters.numResults }),
        },
      };
    },
    renderCall(parameters, theme, context) {
      let text = theme.fg("toolTitle", theme.bold("web_search"));
      if (typeof parameters.query === "string") {
        text += ` ${theme.fg("accent", `"${formatCallValue(parameters.query, context.expanded)}"`)}`;
      }
      if (typeof parameters.numResults === "number") {
        text += theme.fg("muted", ` · requested: ${parameters.numResults} results`);
      }
      if (context.executionStarted && context.isPartial) {
        text += `\n${theme.fg("warning", "Searching…")}`;
      }
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderWebResult("Search", result, options, theme, context.isError);
    },
  });

  pi.registerTool<typeof fetchParameters, FetchDetails>({
    name: "web_fetch",
    label: "Web Fetch",
    description: "Read clean text content from a web page.",
    parameters: fetchParameters,
    async execute(_toolCallId, parameters, signal) {
      const result = await runToolOperation(signal, () => client.fetch(parameters, signal));

      return {
        content: [{ type: "text", text: result.text }],
        details: {
          provider: "exa",
          operation: "fetch",
          auth: result.auth,
          url: parameters.url,
          ...(parameters.maxCharacters === undefined
            ? {}
            : { maxCharacters: parameters.maxCharacters }),
        },
      };
    },
    renderCall(parameters, theme, context) {
      let text = theme.fg("toolTitle", theme.bold("web_fetch"));
      if (typeof parameters.url === "string") {
        text += ` ${theme.fg("accent", formatCallValue(parameters.url, context.expanded))}`;
      }
      if (typeof parameters.maxCharacters === "number") {
        text += theme.fg("muted", ` · requested max: ${parameters.maxCharacters} characters`);
      }
      if (context.executionStarted && context.isPartial) {
        text += `\n${theme.fg("warning", "Fetching…")}`;
      }
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderWebResult("Fetch", result, options, theme, context.isError);
    },
  });
}

function renderWebResult(
  operation: "Search" | "Fetch",
  result: AgentToolResult<SearchDetails | FetchDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  isError: boolean,
): Text {
  const content = readTextContent(result);
  if (isError) {
    const error = content || "Web operation failed";
    if (error.trim() === "Operation aborted") {
      return new Text(theme.fg("warning", "Cancelled"), 0, 0);
    }
    if (options.expanded) {
      return new Text(`${theme.fg("error", "Error")}\n${theme.fg("toolOutput", error)}`, 0, 0);
    }

    const summary = error
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim();
    return new Text(
      theme.fg("error", `Error: ${truncateToWidth(summary ?? "Web operation failed", 160, "…")}`),
      0,
      0,
    );
  }

  const auth = readAuthRoute(result.details);
  let text = theme.fg(
    "success",
    `✓ ${operation} complete${auth === undefined ? "" : ` · ${auth}`}`,
  );
  if (options.expanded) {
    if (content !== "") {
      text += `\n${theme.fg("toolOutput", content)}`;
    }
  } else {
    text += ` (${keyHint("app.tools.expand", "to view result")})`;
  }
  return new Text(text, 0, 0);
}

function readTextContent(result: AgentToolResult<unknown>): string {
  return normalizeDisplayText(
    result.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n\n"),
  );
}

function readAuthRoute(details: unknown): "anonymous" | "API key" | undefined {
  if (typeof details !== "object" || details === null) {
    return undefined;
  }
  const auth: unknown = Reflect.get(details, "auth");
  if (auth === "anonymous") {
    return "anonymous";
  }
  return auth === "api-key" ? "API key" : undefined;
}

async function runToolOperation<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (signal?.aborted === true) {
      throw new Error("Operation aborted", { cause: error });
    }
    throw error;
  }
}

function formatCallValue(value: string, expanded: boolean): string {
  const safeValue = normalizeDisplayText(value);
  return expanded ? safeValue : truncateToWidth(safeValue.replaceAll(/\s+/gu, " "), 120, "…");
}

function normalizeDisplayText(value: string): string {
  return stripTerminalSequences(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
