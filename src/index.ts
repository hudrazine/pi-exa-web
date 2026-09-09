import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExaMcpClient } from "./exa-mcp-client.ts";
import { registerExaWebTools } from "./register-tools.ts";
import { safeError } from "./errors.ts";

export default function exaWebExtension(pi: ExtensionAPI): void {
  const client = createExaMcpClient({ apiKey: process.env.EXA_API_KEY });
  registerExaWebTools(pi, client);
  pi.registerCommand("exa", {
    description: "Show or change the Exa routing strategy",
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/u);
      const selected = parts[1];
      if (
        parts[0] !== "strategy" ||
        parts.length > 2 ||
        (selected !== undefined &&
          selected !== "anonymous-first" &&
          selected !== "authenticated-first")
      ) {
        ctx.ui.notify("Usage: /exa strategy [anonymous-first|authenticated-first]", "info");
        return;
      }
      try {
        const strategy =
          selected === undefined ? await client.getStrategy() : await client.setStrategy(selected);
        ctx.ui.notify(`Exa strategy: ${strategy}`, "info");
      } catch (error) {
        ctx.ui.notify(safeError(error).message, "error");
      }
    },
  });
  pi.on("session_shutdown", async () => {
    await client.close();
  });
}
