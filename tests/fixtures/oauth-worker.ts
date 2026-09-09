import { createExaMcpClient } from "../../src/exa-mcp-client.ts";
import { forwardOAuth } from "./oauth-server.ts";

async function main() {
  globalThis.fetch = forwardOAuth(process.argv[2]);
  const client = createExaMcpClient({ apiKey: "unused-key" });
  const start = new Promise<void>((resolve) => process.once("message", () => resolve()));
  process.send?.("ready");
  await start;
  try {
    const result = await client.search({ query: "process" }, undefined);
    process.send?.({ auth: result.auth, text: result.text });
  } catch (error) {
    process.send?.({
      error: error instanceof Error && "code" in error ? error.code : "unexpected",
    });
    process.exitCode = 1;
  } finally {
    await client.close();
    process.disconnect?.();
  }
}
void main();
