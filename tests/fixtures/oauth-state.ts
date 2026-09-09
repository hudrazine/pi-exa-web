import type { Credentials } from "../../src/state-schema.ts";

// MCP client 2.0.0 provider persistence: issuer is SDK-stamped, expiry is package-owned.
export const credentials: Credentials = {
  resource: "https://mcp.exa.ai/mcp/oauth",
  tokens: {
    access_token: "storage-sentinel-access",
    token_type: "Bearer",
    refresh_token: "storage-sentinel-refresh",
    expires_in: 3600,
    scope: "mcp offline_access",
    issuer: "https://auth.example.test",
  },
  clientInformation: {
    client_id: "client-id",
    client_secret: "storage-sentinel-client-secret",
    redirect_uris: ["http://127.0.0.1:32123/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    issuer: "https://auth.example.test",
  },
  discovery: {
    authorizationServerUrl: "https://auth.example.test",
    authorizationServerMetadata: {
      issuer: "https://auth.example.test",
      authorization_endpoint: "https://auth.example.test/authorize",
      token_endpoint: "https://auth.example.test/token",
      registration_endpoint: "https://auth.example.test/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    },
    resourceMetadata: {
      resource: "https://mcp.exa.ai/mcp/oauth",
      authorization_servers: ["https://auth.example.test"],
    },
    resourceMetadataUrl: "https://mcp.exa.ai/.well-known/oauth-protected-resource/mcp/oauth",
  },
  expiresAt: 1_800_000_000_000,
  loginRequired: false,
};
