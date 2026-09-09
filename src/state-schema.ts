import { isDeepStrictEqual } from "node:util";
import {
  specTypeSchemas,
  checkResourceAllowed,
  type SpecTypeName,
  type SpecTypes,
  type StoredOAuthTokens,
  type StoredOAuthClientInformation,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import { ExaError } from "./errors.ts";

export type Strategy = "anonymous-first" | "authenticated-first";
export interface Settings {
  version: 1;
  strategy: Strategy;
}
export interface Credentials {
  resource: string;
  tokens: StoredOAuthTokens;
  clientInformation: StoredOAuthClientInformation;
  discovery: OAuthDiscoveryState;
  expiresAt?: number;
  loginRequired: boolean;
}
export interface OAuthState {
  version: 1;
  revision: number;
  credentials: Credentials | null;
}
export const oauthResource = "https://mcp.exa.ai/mcp/oauth";

function requireValid(valid: unknown): asserts valid {
  if (!valid) throw new ExaError("storage");
}
function record(value: unknown, keys?: string[]): Record<string, unknown> {
  requireValid(isRecord(value));
  const obj = value;
  if (keys) requireValid(Object.keys(obj).every((key) => keys.includes(key)));
  return obj;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
// Validate with the pinned SDK; reject coercions, stripped fields and defaults in saved JSON.
function sdk<K extends SpecTypeName>(name: K, value: unknown): SpecTypes[K] {
  const result = specTypeSchemas[name]["~standard"].validate(value);
  requireValid(!result.issues);
  requireValid(isDeepStrictEqual(result.value, value));
  return result.value;
}
function url(value: unknown): asserts value is string {
  requireValid(typeof value === "string");
  requireValid(URL.canParse(value));
  const parsed = new URL(value);
  requireValid(
    parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash,
  );
}
function issuersMatch(a: string, b: string): boolean {
  return a === b || a === `${b}/` || b === `${a}/`;
}

export function parseSettings(value: unknown): Settings {
  const obj = record(value, ["version", "strategy"]);
  requireValid(
    obj.version === 1 &&
      (obj.strategy === "anonymous-first" || obj.strategy === "authenticated-first"),
  );
  return { version: 1, strategy: obj.strategy };
}

export function parseOAuth(value: unknown): OAuthState {
  const obj = record(value, ["version", "revision", "credentials"]);
  requireValid(
    obj.version === 1 &&
      typeof obj.revision === "number" &&
      Number.isSafeInteger(obj.revision) &&
      obj.revision >= 0,
  );
  return {
    version: 1,
    revision: obj.revision,
    credentials: obj.credentials === null ? null : parseCredentials(obj.credentials),
  };
}

function parseCredentials(value: unknown): Credentials {
  const obj = record(value, [
    "resource",
    "tokens",
    "clientInformation",
    "discovery",
    "expiresAt",
    "loginRequired",
  ]);
  requireValid(obj.resource === oauthResource && typeof obj.loginRequired === "boolean");
  requireValid(
    obj.expiresAt === undefined ||
      (typeof obj.expiresAt === "number" && Number.isFinite(obj.expiresAt) && obj.expiresAt >= 0),
  );
  const discovery = record(obj.discovery, [
    "authorizationServerUrl",
    "authorizationServerMetadata",
    "resourceMetadata",
    "resourceMetadataUrl",
  ]);
  url(discovery.authorizationServerUrl);
  let metadata;
  if (discovery.authorizationServerMetadata !== undefined) {
    try {
      metadata = sdk("OAuthMetadata", discovery.authorizationServerMetadata);
    } catch {
      metadata = sdk("OpenIdProviderDiscoveryMetadata", discovery.authorizationServerMetadata);
    }
    url(metadata.issuer);
    // Match SDK 2.0.0 discovery's allowance for the URL-added trailing slash.
    requireValid(
      metadata.issuer === discovery.authorizationServerUrl ||
        (discovery.authorizationServerUrl.endsWith("/") &&
          metadata.issuer === discovery.authorizationServerUrl.slice(0, -1)),
    );
    if (metadata.token_endpoint !== undefined) url(metadata.token_endpoint);
    if (metadata.authorization_endpoint !== undefined) url(metadata.authorization_endpoint);
    if (metadata.registration_endpoint !== undefined) url(metadata.registration_endpoint);
  }
  const boundIssuer = metadata?.issuer ?? discovery.authorizationServerUrl;
  if (discovery.resourceMetadataUrl !== undefined) url(discovery.resourceMetadataUrl);
  const resource =
    discovery.resourceMetadata === undefined
      ? undefined
      : sdk("OAuthProtectedResourceMetadata", discovery.resourceMetadata);
  if (resource !== undefined) {
    url(resource.resource);
    requireValid(
      checkResourceAllowed({
        requestedResource: oauthResource,
        configuredResource: resource.resource,
      }) &&
        (!resource.authorization_servers?.length ||
          resource.authorization_servers.some((issuer: string) =>
            issuersMatch(issuer, boundIssuer),
          )),
    );
  }
  const { issuer: tokenIssuer, ...tokenFields } = record(obj.tokens);
  const tokens = sdk("OAuthTokens", tokenFields);
  const { issuer: clientIssuer, ...clientFields } = record(obj.clientInformation);
  const clientInformation =
    "redirect_uris" in clientFields
      ? sdk("OAuthClientInformationFull", clientFields)
      : sdk("OAuthClientInformation", clientFields);
  requireValid(
    typeof tokenIssuer === "string" &&
      typeof clientIssuer === "string" &&
      issuersMatch(tokenIssuer, boundIssuer) &&
      issuersMatch(clientIssuer, boundIssuer),
  );
  requireValid(tokens.access_token.length > 0 && tokens.token_type.toLowerCase() === "bearer");
  requireValid(
    tokens.expires_in === undefined ||
      (Number.isFinite(tokens.expires_in) && tokens.expires_in >= 0 && obj.expiresAt !== undefined),
  );
  requireValid(clientInformation.client_id.length > 0);
  return {
    resource: oauthResource,
    tokens: { ...tokens, issuer: tokenIssuer },
    clientInformation: { ...clientInformation, issuer: clientIssuer },
    discovery: {
      authorizationServerUrl: discovery.authorizationServerUrl,
      ...(metadata === undefined ? {} : { authorizationServerMetadata: metadata }),
      ...(resource === undefined ? {} : { resourceMetadata: resource }),
      ...(discovery.resourceMetadataUrl === undefined
        ? {}
        : { resourceMetadataUrl: discovery.resourceMetadataUrl }),
    },
    ...(obj.expiresAt === undefined ? {} : { expiresAt: obj.expiresAt }),
    loginRequired: obj.loginRequired,
  };
}
