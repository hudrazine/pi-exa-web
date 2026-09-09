import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createAnonymousFirstPolicy, type AuthRoute } from "../src/anonymous-first.ts";
import { ExaError, readRetryAt } from "../src/errors.ts";

const signal = new AbortController().signal;
const now = Date.parse("2026-08-17T00:00:00Z");
afterEach(() => vi.useRealTimers());

describe("anonymous-first intent policy", () => {
  test("returns the route of each concurrent successful operation", async () => {
    const policy = createAnonymousFirstPolicy(true);
    const fallback = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", Date.now() + 10_000))
      .mockResolvedValueOnce("key");
    const anonymous = vi.fn(async () => "anonymous");
    expect(
      await Promise.all([policy.run(fallback, signal), policy.run(anonymous, signal)]),
    ).toEqual([
      { result: "key", auth: "api-key" },
      { result: "anonymous", auth: "anonymous" },
    ]);
    expect(fallback.mock.calls).toEqual([["anonymous"], ["api-key"]]);
    expect(anonymous).toHaveBeenCalledOnce();
  });

  test.each([0, 1_000, 2_000])("probes once after a %i ms header delay", async (delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const policy = createAnonymousFirstPolicy(true);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", now + delay))
      .mockResolvedValueOnce("ok");
    const pending = policy.run(run, signal);
    if (delay > 0) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(run).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
    } else await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual({ result: "ok", auth: "anonymous" });
    expect(run.mock.calls).toEqual([["anonymous"], ["anonymous"]]);
  });

  test.each([undefined, now + 3_000])("skips probing for deadline %s", async (deadline) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", deadline))
      .mockResolvedValue("key");
    const policy = createAnonymousFirstPolicy(true);
    expect(await policy.run(run, signal)).toEqual({ result: "key", auth: "api-key" });
    expect(await policy.run(run, signal)).toEqual({ result: "key", auth: "api-key" });
    expect(run.mock.calls).toEqual([["anonymous"], ["api-key"], ["api-key"]]);
  });

  test.each([undefined, now + 4_000])(
    "blocks without a key until deadline %s",
    async (deadline) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const run = vi
        .fn<(route: AuthRoute) => Promise<string>>()
        .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", deadline))
        .mockResolvedValue("ok");
      const policy = createAnonymousFirstPolicy(false);
      await expect(policy.run(run, signal)).rejects.toMatchObject({
        code: "anonymous-rate-limit",
        retryAt: deadline,
      });
      await expect(policy.run(run, signal)).rejects.toThrow("EXA_API_KEY");
      expect(run).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync((deadline ?? now + 1_000) - now);
      expect(await policy.run(run, signal)).toEqual({ result: "ok", auth: "anonymous" });
    },
  );

  test("uses the second 429 deadline and never probes twice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const policy = createAnonymousFirstPolicy(false);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", now + 1_000))
      .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", now + 31_000));
    const pending = expect(policy.run(run, signal)).rejects.toMatchObject({
      code: "anonymous-rate-limit",
      retryAt: now + 31_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    await vi.advanceTimersByTimeAsync(29_000);
    await expect(policy.run(run, signal)).rejects.toThrow("EXA_API_KEY");
    expect(run.mock.calls).toEqual([["anonymous"], ["anonymous"]]);
  });

  test.each([
    "authenticated-rate-limit",
    "authentication",
    "permission",
    "server",
    "transport",
    "tool",
  ] as const)(
    "keeps final %s failure without anonymous retry time or another fallback",
    async (code) => {
      const final = new ExaError(code);
      const run = vi
        .fn<(route: AuthRoute) => Promise<string>>()
        .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", Date.now() + 10_000))
        .mockRejectedValueOnce(final);
      await expect(createAnonymousFirstPolicy(true).run(run, signal)).rejects.toBe(final);
      expect(run.mock.calls).toEqual([["anonymous"], ["api-key"]]);
      expect(final.retryAt).toBeUndefined();
    },
  );

  test("cancels a delay with the original reason and never falls back", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("private abort detail");
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", Date.now() + 2_000));
    const pending = createAnonymousFirstPolicy(true).run(run, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledOnce();
  });

  test("clears process-local block state", async () => {
    const policy = createAnonymousFirstPolicy(false);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new ExaError("anonymous-rate-limit", Date.now() + 60_000))
      .mockResolvedValue("ok");
    await expect(policy.run(run, signal)).rejects.toThrow();
    policy.clear();
    expect(await policy.run(run, signal)).toEqual({ result: "ok", auth: "anonymous" });
  });
});

describe("header-derived retry evidence", () => {
  test.each([
    [{ "retry-after": "1" }, now + 1_000],
    [{ "retry-after": "0" }, now],
    [{ "retry-after": "Mon, 17 Aug 2026 00:00:04 GMT" }, now + 4_000],
    [{ "retry-after": "Sun, 16 Aug 2026 00:00:00 GMT" }, now],
    [{ "x-ratelimit-reset": "1786924804" }, now + 4_000],
    [{ "x-ratelimit-reset": "1786924804000" }, now + 4_000],
    [{ "x-ratelimit-reset": "1" }, now],
    [{ "retry-after": "1", "x-ratelimit-reset": "1786924804000" }, now + 1_000],
    [{ "retry-after": "invalid", "x-ratelimit-reset": "1786924804000" }, now + 4_000],
    [{}, undefined],
    [{ "retry-after": "", "x-ratelimit-reset": " " }, undefined],
    [{ "retry-after": "-1", "x-ratelimit-reset": "-2" }, undefined],
    [{ "retry-after": "Infinity", "x-ratelimit-reset": "NaN" }, undefined],
    [{ "retry-after": "1e309", "x-ratelimit-reset": "1e309" }, undefined],
    [{ "retry-after": "1e308" }, undefined],
  ])("parses %j without inventing an upstream deadline", (headers, expected) => {
    expect(readRetryAt(new Headers(headers as Record<string, string>), now)).toBe(expected);
  });
});
