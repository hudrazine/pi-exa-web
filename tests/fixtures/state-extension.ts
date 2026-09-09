import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createStateStore } from "../../src/state-store.ts";
import { registerExaWebTools } from "../../src/register-tools.ts";

// Exercise production storage via Pi's jiti loader without adding a production command.
export default function stateExtension(pi: ExtensionAPI) {
  const store = createStateStore();
  registerExaWebTools(pi, {
    async search(_args, signal) {
      const state = await store.updateOAuth(async () => null, { signal });
      return { text: String(state.revision), auth: "anonymous" };
    },
    async fetch() {
      const state = await store.readOAuth();
      return { text: String(state.revision), auth: "anonymous" };
    },
  });
}
