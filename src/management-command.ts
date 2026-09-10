import {
  BorderedLoader,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import childProcess from "node:child_process";
import { ExaError, safeError } from "./errors.ts";
import type { ExaMcpClient, ExaStatus } from "./exa-mcp-client.ts";

const usage =
  "Usage: /exa login | logout | status | strategy [anonymous-first|authenticated-first]";
const oauthLabels: Record<ExaStatus["oauth"], string> = {
  unconfigured: "not configured",
  "locally-available": "locally available",
  "expired-refreshable": "expired; refresh available",
  "login-required": "login required",
};

function getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const parts = prefix.trimStart().split(/\s+/u);
  let items: AutocompleteItem[];
  if (parts.length === 1) {
    items = [
      { value: "login", label: "login", description: "Log in with OAuth in interactive Pi" },
      { value: "logout", label: "logout", description: "Remove local OAuth credentials" },
      { value: "status", label: "status", description: "Show local authentication status" },
      { value: "strategy", label: "strategy", description: "Show or change routing strategy" },
    ];
  } else if (parts.length === 2 && parts[0] === "strategy") {
    items = [
      {
        value: "strategy anonymous-first",
        label: "anonymous-first",
        description: "Prefer anonymous access",
      },
      {
        value: "strategy authenticated-first",
        label: "authenticated-first",
        description: "Prefer available authentication",
      },
    ];
  } else {
    return null;
  }
  const filtered = items.filter((item) => item.label.startsWith(parts.at(-1)!));
  return filtered.length > 0 ? filtered : null;
}

export function registerExaCommand(pi: ExtensionAPI, client: ExaMcpClient): void {
  let loginScreenActive = false;
  pi.registerCommand("exa", {
    description: "Manage Exa login, local status and routing strategy",
    getArgumentCompletions,
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/u);
      const command = parts[0];
      const selected = parts[1];
      const strategy =
        command === "strategy" &&
        parts.length <= 2 &&
        (selected === undefined ||
          selected === "anonymous-first" ||
          selected === "authenticated-first");
      if (!strategy && !(parts.length === 1 && ["login", "logout", "status"].includes(command))) {
        ctx.ui.notify(usage, "info");
        return;
      }
      try {
        if (command === "login") {
          if (ctx.mode !== "tui") {
            ctx.ui.notify(
              "Run /exa login in a local interactive Pi using the same agent directory.",
              "info",
            );
            return;
          }
          if (loginScreenActive) throw new ExaError("login-in-progress");
          loginScreenActive = true;
          try {
            await loginScreen(ctx, client);
          } finally {
            loginScreenActive = false;
          }
        } else if (command === "logout") {
          await client.logout(ctx.signal);
          ctx.ui.notify("Exa OAuth credentials removed locally.", "info");
        } else if (command === "status") {
          const status = await client.getStatus();
          ctx.ui.notify(
            [
              `Exa strategy: ${status.strategy}`,
              `OAuth: ${oauthLabels[status.oauth]}`,
              `API key: ${status.apiKey ? "configured" : "not configured"}`,
              `Local authentication candidate: ${status.authentication}`,
              "Local status only; server acceptance and credits are not checked.",
            ].join("\n"),
            "info",
          );
        } else {
          const value =
            selected === "anonymous-first" || selected === "authenticated-first"
              ? await client.setStrategy(selected)
              : await client.getStrategy();
          ctx.ui.notify(`Exa strategy: ${value}`, "info");
        }
      } catch (error) {
        ctx.ui.notify(
          ctx.signal?.aborted ? "Operation aborted" : safeError(error).message,
          "error",
        );
      }
    },
  });
}

async function loginScreen(ctx: ExtensionCommandContext, client: ExaMcpClient): Promise<void> {
  const result = await ctx.ui.custom<ExaError | undefined>((tui, theme, _keys, done) => {
    const disposed = new AbortController();
    const loader = new BorderedLoader(tui, theme, "Waiting for Exa login…");
    const link = new Text("Preparing authorization…", 1, 1);
    loader.addChild(link);
    const signal = AbortSignal.any([
      disposed.signal,
      loader.signal,
      ...(ctx.signal ? [ctx.signal] : []),
    ]);
    const disposeLoader = loader.dispose.bind(loader);
    loader.dispose = () => {
      disposed.abort(new ExaError("login-cancelled"));
      link.setText("");
      disposeLoader();
    };
    // Let Pi install the component before a synchronously rejected operation can dismiss it.
    void Promise.resolve()
      .then(() =>
        client.login((url) => {
          link.setText(`Open this URL to authorize Exa:\n${url.href}`);
          tui.requestRender();
          openBrowser(url);
        }, signal),
      )
      .then(
        () => done(undefined),
        (error: unknown) => {
          done(signal.aborted ? new ExaError("login-cancelled") : safeError(error));
        },
      );
    return loader;
  });
  ctx.ui.notify(result?.message ?? "Exa login saved.", result ? "error" : "info");
}

function openBrowser(url: URL): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url.href]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url.href]]
        : ["xdg-open", [url.href]];
  try {
    const child = childProcess.spawn(command, args, {
      shell: false,
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The transient screen still contains the URL for manual authorization.
  }
}
