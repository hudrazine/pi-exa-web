const messages = {
  "anonymous-rate-limit":
    "Exa anonymous MCP rate limit reached. Run /exa login, set EXA_API_KEY from https://dashboard.exa.ai/api-keys or retry later.",
  "authenticated-rate-limit": "Exa authenticated rate limit reached. Retry later.",
  "credits-exhausted": "Exa account credits are exhausted.",
  authentication: "Exa authentication failed.",
  permission: "Exa denied this request.",
  transport: "Could not complete the Exa MCP request.",
  server: "Exa is temporarily unavailable.",
  tool: "Exa returned an unsuccessful or unexpected tool response.",
  storage: "Could not read or save Exa settings or credentials.",
  "storage-conflict": "Exa credentials changed. Start login again.",
  "login-in-progress": "Exa login is already in progress.",
  "login-timeout": "Exa login timed out. Start login again.",
  "login-denied": "Exa login was denied.",
  "login-cancelled": "Exa login cancelled.",
  lifecycle: "pi-exa-web MCP client is closed",
} as const;

export type FailureCode = keyof typeof messages;

// Only package-owned text and allowlisted metadata cross the Pi boundary.
export class ExaError extends Error {
  readonly code: FailureCode;
  readonly retryAt?: number;

  constructor(code: FailureCode, retryAt?: number) {
    super(messages[code]);
    this.name = "ExaError";
    this.code = code;
    if (retryAt !== undefined && Number.isFinite(retryAt)) this.retryAt = retryAt;
  }
}

// HTTP observation time is private evidence, stripped at the client boundary.
export class AnonymousRateLimitError extends ExaError {
  readonly observedAt: number;
  constructor(observedAt: number, retryAt?: number) {
    super("anonymous-rate-limit", retryAt);
    this.observedAt = observedAt;
  }
}

export function safeError(error: unknown): ExaError {
  return error instanceof ExaError
    ? new ExaError(error.code, error.retryAt)
    : new ExaError("transport");
}

export function readRetryAt(headers: Headers, now: number): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null && retryAfter.trim() !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      const deadline = now + seconds * 1_000;
      if (seconds >= 0 && Number.isFinite(deadline)) return deadline;
    } else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.max(now, date);
    }
  }
  const value = headers.get("x-ratelimit-reset");
  if (value !== null && value.trim() !== "") {
    const reset = Number(value);
    const deadline = reset >= 1_000_000_000_000 ? reset : reset * 1_000;
    if (reset >= 0 && Number.isFinite(deadline)) return Math.max(now, deadline);
  }
  return undefined;
}
