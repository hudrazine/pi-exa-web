import { AnonymousRateLimitError, ExaError } from "./errors.ts";
import type { Strategy } from "./state-schema.ts";
import { OAuthUnavailableError } from "./oauth-state.ts";

export type AuthRoute = "anonymous" | "oauth" | "api-key";
export type AuthenticatedRoute = Exclude<AuthRoute, "anonymous">;
export interface RouteResult<T> {
  result: T;
  auth: AuthRoute;
}
export class CreditsExhaustedError extends ExaError {
  readonly auth: AuthenticatedRoute;
  constructor(auth: AuthenticatedRoute) {
    super("credits-exhausted");
    this.auth = auth;
  }
}
export interface Fallback {
  from: AuthRoute;
  to: AuthRoute;
  reason: "anonymous-rate-limit" | "credits-exhausted";
}

export function createAnonymousFirstPolicy(
  resolveAuthenticated: (signal: AbortSignal) => Promise<AuthenticatedRoute | undefined>,
) {
  let blockedUntil = 0;
  return {
    async run<T>(
      operation: (route: AuthRoute) => Promise<RouteResult<T>>,
      signal: AbortSignal,
      strategy: Strategy = "anonymous-first",
    ): Promise<RouteResult<T> & { fallback?: Fallback }> {
      signal.throwIfAborted();
      async function anonymous(): Promise<RouteResult<T>> {
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
      async function execute(route: AuthRoute): Promise<RouteResult<T>> {
        signal.throwIfAborted();
        return route === "anonymous" ? anonymous() : operation(route);
      }
      const primary: AuthRoute =
        strategy === "authenticated-first" || blockedUntil > Date.now()
          ? ((await resolveAuthenticated(signal)) ?? "anonymous")
          : "anonymous";
      try {
        return await execute(primary);
      } catch (error) {
        signal.throwIfAborted();
        // An unavailable credential before any tool send changes primary selection.
        if (primary !== "anonymous" && error instanceof OAuthUnavailableError) return anonymous();
        if (!(error instanceof ExaError)) throw error;
        let fallback: Fallback;
        if (primary === "anonymous" && error instanceof AnonymousRateLimitError) {
          const authenticated = await resolveAuthenticated(signal);
          if (authenticated === undefined) throw error;
          signal.throwIfAborted();
          blockedUntil = Math.max(blockedUntil, error.retryAt ?? error.observedAt + 1_000);
          fallback = { from: primary, to: authenticated, reason: "anonymous-rate-limit" };
        } else if (error instanceof CreditsExhaustedError) {
          fallback = { from: error.auth, to: "anonymous", reason: "credits-exhausted" };
        } else throw error;
        const outcome = await execute(fallback.to);
        return { ...outcome, fallback: { ...fallback, to: outcome.auth } };
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
