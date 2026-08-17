import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExaMcpClient } from "./exa-mcp-client.ts";
import { registerExaWebTools } from "./register-tools.ts";

export default function exaWebExtension(pi: ExtensionAPI): void {
  const client = createExaMcpClient({ apiKey: process.env.EXA_API_KEY });
  registerExaWebTools(pi, client);
  pi.on("session_shutdown", async () => {
    await client.close();
  });
}
