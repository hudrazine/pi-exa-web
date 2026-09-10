import { createExaMcpClient } from "../../src/exa-mcp-client.ts";
import { forwardLogin } from "./login-server.ts";

async function main() {
  globalThis.fetch = forwardLogin(process.argv[2]);
  const client = createExaMcpClient();
  const start = new Promise<void>((resolve) => process.once("message", () => resolve()));
  process.send?.({ kind: "ready" });
  await start;
  try {
    if (process.argv[3] === "login")
      await client.login((url) => process.send?.({ kind: "authorization", url: url.href }));
    else if (process.argv[3] === "logout") await client.logout();
    else await client.search({ query: "refresh fixture" }, undefined);
    process.send?.({ kind: "result", code: "success" });
  } catch (error) {
    process.send?.({
      kind: "result",
      code: error instanceof Error && "code" in error ? error.code : "unexpected",
    });
  } finally {
    await client.close();
    process.disconnect?.();
  }
}
void main();
