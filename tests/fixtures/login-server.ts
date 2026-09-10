import { createHash } from "node:crypto";
import { oauthServer, type OAuthRequest, type OAuthReply } from "./oauth-server.ts";
import { credentials } from "./oauth-state.ts";

// HTTPS discovery and token endpoints are forwarded only inside these interactive fixtures.
export function forwardLogin(origin: string, nativeFetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (
      !["https://mcp.exa.ai", "https://auth.example.test"].includes(url.origin) ||
      ![
        "/.well-known/oauth-protected-resource/mcp/oauth",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-authorization-server",
        "/register",
        "/token",
        "/mcp/oauth",
        "/mcp",
      ].includes(url.pathname)
    )
      throw new Error("Unexpected login fixture request");
    return nativeFetch(new URL(url.pathname + url.search, origin), init);
  };
}

export async function loginServer(
  handle: (
    request: OAuthRequest,
  ) => OAuthReply | undefined | Promise<OAuthReply | undefined> = () => undefined,
) {
  const codes = new Map<string, URL>();
  let registration = 0;
  let issued = 0;
  const server = await oauthServer(async (request) => {
    const override = await handle(request);
    if (override) return override;
    if (request.path.startsWith("/.well-known/oauth-protected-resource"))
      return {
        status: 200,
        json: { ...credentials.discovery.resourceMetadata, scopes_supported: ["mcp"] },
      };
    if (request.path === "/.well-known/oauth-authorization-server")
      return {
        status: 200,
        json: {
          ...credentials.discovery.authorizationServerMetadata,
          scopes_supported: ["mcp", "offline_access"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          authorization_response_iss_parameter_supported: true,
        },
      };
    if (request.path === "/register")
      return {
        status: 201,
        json: {
          ...request.message,
          client_id: `login-client-${++registration}`,
          client_secret: "login-sentinel-client-secret",
          token_endpoint_auth_method: "client_secret_post",
        },
      };
    if (request.path === "/token" && request.form.get("grant_type") === "authorization_code") {
      const authorization = codes.get(request.form.get("code") ?? "");
      const challenge = createHash("sha256")
        .update(request.form.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !authorization ||
        challenge !== authorization.searchParams.get("code_challenge") ||
        request.form.get("redirect_uri") !== authorization.searchParams.get("redirect_uri") ||
        request.form.get("resource") !== credentials.resource ||
        request.form.get("client_id") !== authorization.searchParams.get("client_id") ||
        request.form.get("client_secret") !== "login-sentinel-client-secret"
      )
        return {
          status: 400,
          json: { error: "invalid_grant", error_description: "login-sentinel-exchange" },
        };
      codes.delete(request.form.get("code")!);
      return {
        status: 200,
        json: {
          access_token: "login-sentinel-access",
          refresh_token: "login-sentinel-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        },
      };
    }
    return undefined;
  });
  return {
    ...server,
    callbackURL(authorization: URL) {
      const code = `login-sentinel-code-${++issued}`;
      codes.set(code, authorization);
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", authorization.searchParams.get("state")!);
      callback.searchParams.set("iss", "https://auth.example.test");
      return callback;
    },
  };
}
