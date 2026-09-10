import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createStateStore } from "../../src/state-store.ts";
import { createExaMcpClient } from "../../src/exa-mcp-client.ts";

function waitFor(command: string): Promise<void> {
  return new Promise((resolve) => {
    const listener = (message: unknown) => {
      if (message === command) {
        process.off("message", listener);
        resolve();
      }
    };
    process.on("message", listener);
  });
}
async function main() {
  const mode = process.argv[2];
  const store = createStateStore();
  const start = waitFor("start");
  process.send?.("ready");
  await start;
  try {
    if (mode === "settings") {
      const rename = fs.rename;
      fs.rename = async (from, to) => {
        const release = waitFor("replace");
        process.send?.("before-replace");
        await release;
        return rename(from, to);
      };
      syncBuiltinESMExports();
      await store.writeSettings({
        version: 1,
        strategy: process.argv[3] === "anonymous-first" ? "anonymous-first" : "authenticated-first",
      });
    } else if (mode === "no-sqlite") {
      const client = createExaMcpClient();
      if ((await client.getStatus()).oauth !== "unconfigured") throw new Error("Wrong status");
      await client.setStrategy("authenticated-first");
      if ((await client.getStrategy()) !== "authenticated-first") throw new Error("Wrong strategy");
      await client.close();
      try {
        await store.updateOAuth(async () => null);
      } catch (error) {
        process.send?.({
          code: error instanceof Error && "code" in error ? error.code : "unexpected",
        });
      }
    } else {
      await store.updateOAuth(async () => {
        const release = waitFor("release");
        process.send?.("entered");
        await release;
        return null;
      });
    }
    process.send?.("done");
  } catch (error) {
    process.send?.({
      error: error instanceof Error && "code" in error ? error.code : "unexpected",
    });
    process.exitCode = 1;
  }
  process.disconnect?.();
}
void main();
