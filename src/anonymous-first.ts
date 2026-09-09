import { ExaError } from "./errors.ts";

export type AuthRoute = "anonymous" | "api-key";

export function createAnonymousFirstPolicy(hasApiKey: boolean) {
  let blockedUntil = 0;
  let blockedRetryAt: number | undefined;

  return {
    async run<T>(operation: (route: AuthRoute) => Promise<T>, signal: AbortSignal) {
      signal.throwIfAborted();
      const authenticated = async (retryAt?: number) => {
        signal.throwIfAborted();
        if (!hasApiKey) throw new ExaError("anonymous-rate-limit", retryAt);
        return { result: await operation("api-key"), auth: "api-key" as const };
      };
      if (blockedUntil > Date.now()) return authenticated(blockedRetryAt);
      blockedUntil = 0;
      blockedRetryAt = undefined;

      let limit: ExaError;
      try {
        return { result: await operation("anonymous"), auth: "anonymous" as const };
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof ExaError) || error.code !== "anonymous-rate-limit") throw error;
        limit = error;
      }
      if (limit.retryAt !== undefined && limit.retryAt - Date.now() <= 2_000) {
        await abortableDelay(Math.max(0, limit.retryAt - Date.now()), signal);
        try {
          return { result: await operation("anonymous"), auth: "anonymous" as const };
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof ExaError) || error.code !== "anonymous-rate-limit") throw error;
          limit = error;
        }
      }
      blockedRetryAt = limit.retryAt;
      blockedUntil = limit.retryAt ?? Date.now() + 1_000;
      return authenticated(limit.retryAt);
    },
    clear() {
      blockedUntil = 0;
      blockedRetryAt = undefined;
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
