import {
  OAuthError,
  OAuthErrorCode,
  refreshAuthorization,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { ExaError } from "./errors.ts";
import type { OAuthState } from "./state-schema.ts";
import type { createStateStore } from "./state-store.ts";

// Only authentication and refresh-network failures may select another credential before a tool send.
export class OAuthUnavailableError extends ExaError {}
const terminalCodes: readonly string[] = [
  OAuthErrorCode.InvalidGrant,
  OAuthErrorCode.InvalidClient,
  OAuthErrorCode.UnauthorizedClient,
];
const serverErrorCode: string = OAuthErrorCode.ServerError;

export function usableOAuth(state: OAuthState): boolean {
  const credentials = state.credentials;
  return (
    credentials !== null &&
    !credentials.loginRequired &&
    (credentials.expiresAt === undefined || credentials.expiresAt > Date.now())
  );
}

export function createOAuthState(store: ReturnType<typeof createStateStore>, fetchFn: FetchLike) {
  const pending = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> {
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    );
    return work;
  }

  async function refresh(
    rejectedRevision: number | undefined,
    signal: AbortSignal,
  ): Promise<OAuthState> {
    let failure: ExaError | undefined;
    const committed = await store.updateOAuth(
      async (latest) => {
        const current = latest.credentials;
        if (current === null || current.loginRequired) {
          failure = new OAuthUnavailableError("authentication");
          return undefined;
        }
        if (
          usableOAuth(latest) &&
          (rejectedRevision === undefined || latest.revision !== rejectedRevision)
        )
          return undefined;
        if (!current.tokens.refresh_token) {
          failure = new OAuthUnavailableError("authentication");
          return undefined;
        }
        let transient = false;
        let receivedAt = 0;
        const refreshFetch: FetchLike = async (input, init) => {
          signal.throwIfAborted();
          const combined = AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]);
          let response: Response;
          let body: ArrayBuffer;
          try {
            response = await fetchFn(input, { ...init, signal: combined });
            // Distinguish an interrupted HTTP body from SDK JSON/schema rejection.
            body = await response.arrayBuffer();
          } catch {
            signal.throwIfAborted();
            transient = true;
            throw new OAuthUnavailableError("transport");
          }
          receivedAt = Date.now();
          transient = response.status === 429 || (response.status >= 500 && response.status <= 599);
          return response.body === null
            ? response
            : new Response(body, {
                status: response.status,
                headers: response.headers,
              });
        };
        try {
          const tokens = await refreshAuthorization(current.discovery.authorizationServerUrl, {
            metadata: current.discovery.authorizationServerMetadata,
            clientInformation: current.clientInformation,
            refreshToken: current.tokens.refresh_token,
            resource: new URL(current.resource),
            fetchFn: refreshFetch,
          });
          signal.throwIfAborted();
          const { expiresAt: _previousExpiry, ...retained } = current;
          return {
            ...retained,
            tokens: { ...tokens, issuer: current.tokens.issuer },
            ...(tokens.expires_in === undefined
              ? {}
              : { expiresAt: receivedAt + tokens.expires_in * 1_000 }),
            loginRequired: false,
          };
        } catch (error) {
          signal.throwIfAborted();
          if (transient) {
            failure = new OAuthUnavailableError("transport");
          } else if (error instanceof OAuthError && error.code !== serverErrorCode) {
            failure = new OAuthUnavailableError("authentication");
            if (terminalCodes.includes(error.code)) {
              return { ...current, loginRequired: true };
            }
          } else {
            failure = new ExaError("transport");
          }
          return undefined;
        }
      },
      { signal },
    );
    signal.throwIfAborted();
    // Storage/cleanup errors escape before a remote outcome can permit alternate selection.
    if (failure !== undefined) throw failure;
    if (!usableOAuth(committed)) throw new OAuthUnavailableError("authentication");
    return committed;
  }

  return {
    read: store.readOAuth,
    async resolve(signal: AbortSignal): Promise<OAuthState | undefined> {
      signal.throwIfAborted();
      const state = await store.readOAuth();
      signal.throwIfAborted();
      if (usableOAuth(state)) return state;
      if (
        !state.credentials ||
        state.credentials.loginRequired ||
        !state.credentials.tokens.refresh_token
      )
        return undefined;
      return track(refresh(undefined, signal));
    },
    refresh(rejectedRevision: number, signal: AbortSignal) {
      return track(refresh(rejectedRevision, signal));
    },
    logout(signal: AbortSignal) {
      return track(store.updateOAuth(async () => null, { signal }));
    },
    async settled() {
      await Promise.allSettled(pending);
    },
  };
}
