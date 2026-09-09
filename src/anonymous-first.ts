import { AnonymousRateLimitError, ExaError } from "./errors.ts";
import type { Strategy } from "./state-schema.ts";

export type AuthRoute = "anonymous" | "api-key";
export interface Fallback {
  from: AuthRoute;
  to: AuthRoute;
  reason: "anonymous-rate-limit" | "credits-exhausted";
}

export function createAnonymousFirstPolicy(hasApiKey: boolean) {
  let blockedUntil = 0;
  return {
    async run<T>(
      operation: (route: AuthRoute) => Promise<T>,
      signal: AbortSignal,
      strategy: Strategy = "anonymous-first",
    ) {
      signal.throwIfAborted();
      async function anonymous(): Promise<T> {
        let probed = false;
        for (;;) {
          signal.throwIfAborted();
          try {
            const result = await operation("anonymous");
            signal.throwIfAborted();
            blockedUntil = 0;
            return result;
          } catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof AnonymousRateLimitError)) throw error;
            const delay =
              error.retryAt === undefined ? 1_000 : Math.max(0, error.retryAt - Date.now());
            if (probed || delay > 2_000) throw error;
            probed = true;
            await abortableDelay(delay, signal);
          }
        }
      }
      async function execute(route: AuthRoute): Promise<T> {
        signal.throwIfAborted();
        return route === "anonymous" ? anonymous() : operation(route);
      }
      const primary: AuthRoute =
        hasApiKey && (strategy === "authenticated-first" || blockedUntil > Date.now())
          ? "api-key"
          : "anonymous";
      try {
        return { result: await execute(primary), auth: primary };
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof ExaError)) throw error;
        let fallback: Fallback;
        if (primary === "anonymous" && error instanceof AnonymousRateLimitError && hasApiKey) {
          blockedUntil = Math.max(blockedUntil, error.retryAt ?? error.observedAt + 1_000);
          fallback = { from: primary, to: "api-key", reason: "anonymous-rate-limit" };
        } else if (primary === "api-key" && error.code === "credits-exhausted") {
          fallback = { from: primary, to: "anonymous", reason: "credits-exhausted" };
        } else throw error;
        return { result: await execute(fallback.to), auth: fallback.to, fallback };
      }
    },
    clear() {
      blockedUntil = 0;
    },
  };
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    function abort(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
