import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createAnonymousFirstPolicy, type AuthRoute } from "../src/anonymous-first.ts";
import { AnonymousRateLimitError, ExaError, readRetryAt } from "../src/errors.ts";

const signal = new AbortController().signal;
const now = Date.parse("2026-08-17T00:00:00Z");
const rateFallback = { from: "anonymous", to: "api-key", reason: "anonymous-rate-limit" };
const creditFallback = { from: "api-key", to: "anonymous", reason: "credits-exhausted" };
afterEach(() => vi.useRealTimers());

describe("bounded route policy", () => {
  test.each([0, 1_000, 2_000, undefined])("probes once after delay %s", async (delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const policy = createAnonymousFirstPolicy(true);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(
        new AnonymousRateLimitError(now, delay === undefined ? undefined : now + delay),
      )
      .mockResolvedValue("ok");
    const pending = policy.run(run, signal);
    const wait = delay ?? 1_000;
    if (wait > 0) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(run).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
    } else await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual({ result: "ok", auth: "anonymous" });
    expect(run.mock.calls).toEqual([["anonymous"], ["anonymous"]]);
  });

  test("skips a long probe, selects a cooldown primary, and expires at the deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const policy = createAnonymousFirstPolicy(true);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new AnonymousRateLimitError(now, now + 3_000))
      .mockResolvedValue("ok");
    expect(await policy.run(run, signal)).toEqual({
      result: "ok",
      auth: "api-key",
      fallback: rateFallback,
    });
    expect(await policy.run(run, signal)).toEqual({ result: "ok", auth: "api-key" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await policy.run(run, signal)).toEqual({ result: "ok", auth: "anonymous" });
    expect(run.mock.calls).toEqual([["anonymous"], ["api-key"], ["api-key"], ["anonymous"]]);
  });

  test.each([undefined, now + 30_000])(
    "no key: bounded handling and another anonymous call, deadline %s",
    async (deadline) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const run = vi
        .fn<(route: AuthRoute) => Promise<string>>()
        .mockRejectedValueOnce(new AnonymousRateLimitError(now, now))
        .mockRejectedValueOnce(new AnonymousRateLimitError(now, deadline))
        .mockResolvedValue("ok");
      const policy = createAnonymousFirstPolicy(false);
      const pending = expect(policy.run(run, signal)).rejects.toMatchObject({
        code: "anonymous-rate-limit",
        retryAt: deadline,
      });
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      expect(await policy.run(run, signal)).toEqual({ result: "ok", auth: "anonymous" });
      expect(run.mock.calls).toEqual([["anonymous"], ["anonymous"], ["anonymous"]]);
    },
  );

  test("uses the final observation for fixed no-header cooldown, even after delayed delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const policy = createAnonymousFirstPolicy(true);
    const run = vi.fn(async (route: AuthRoute) => {
      if (route === "anonymous") throw new AnonymousRateLimitError(Date.now() - 100);
      return "key";
    });
    for (let cycle = 0; cycle < 3; cycle++) {
      const pending = policy.run(run, signal);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ result: "key", auth: "api-key", fallback: rateFallback });
      await vi.advanceTimersByTimeAsync(899);
      expect(await policy.run(run, signal)).toEqual({ result: "key", auth: "api-key" });
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(run.mock.calls.filter(([route]) => route === "anonymous")).toHaveLength(6);
  });

  test("concurrent failures preserve a later active deadline; anonymous success clears it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const policy = createAnonymousFirstPolicy(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const late = policy
      .run(async () => {
        await gate;
        throw new AnonymousRateLimitError(now, now + 4_000);
      }, signal)
      .catch((error: unknown) => error);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new AnonymousRateLimitError(now, now + 10_000))
      .mockResolvedValue("ok");
    expect(await policy.run(run, signal)).toMatchObject({ fallback: rateFallback });
    release();
    await late;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await policy.run(run, signal)).toEqual({ result: "ok", auth: "api-key" });
    const reverse = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new ExaError("credits-exhausted"))
      .mockResolvedValue("ok");
    expect(await policy.run(reverse, signal)).toEqual({
      result: "ok",
      auth: "anonymous",
      fallback: creditFallback,
    });
    expect(await policy.run(run, signal)).toEqual({ result: "ok", auth: "anonymous" });
  });

  test("concurrent operations return their own auth and fallback", async () => {
    const policy = createAnonymousFirstPolicy(true);
    const limited = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new AnonymousRateLimitError(Date.now(), Date.now() + 30_000))
      .mockResolvedValue("key");
    expect(
      await Promise.all([policy.run(limited, signal), policy.run(async () => "anon", signal)]),
    ).toEqual([
      { result: "key", auth: "api-key", fallback: rateFallback },
      { result: "anon", auth: "anonymous" },
    ]);
  });

  test.each([true, false])("authenticated-first resolves key availability %s", async (hasKey) => {
    const run = vi.fn(async () => "ok");
    expect(
      await createAnonymousFirstPolicy(hasKey).run(run, signal, "authenticated-first"),
    ).toEqual({ result: "ok", auth: hasKey ? "api-key" : "anonymous" });
    expect(run.mock.calls).toHaveLength(1);
  });

  test("authenticated fallback may probe but cannot return to authentication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new ExaError("credits-exhausted"))
      .mockRejectedValueOnce(new AnonymousRateLimitError(now))
      .mockRejectedValueOnce(new AnonymousRateLimitError(now + 1_000, now + 20_000));
    const pending = expect(
      createAnonymousFirstPolicy(true).run(run, signal, "authenticated-first"),
    ).rejects.toMatchObject({ code: "anonymous-rate-limit", retryAt: now + 20_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run.mock.calls).toEqual([["api-key"], ["anonymous"], ["anonymous"]]);
  });

  test.each([
    "credits-exhausted",
    "authenticated-rate-limit",
    "authentication",
    "permission",
    "server",
    "transport",
    "tool",
    "storage",
    "storage-conflict",
  ] as const)("keeps final %s without the anonymous deadline or another fallback", async (code) => {
    const final = new ExaError(code);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new AnonymousRateLimitError(Date.now(), Date.now() + 10_000))
      .mockRejectedValueOnce(final);
    await expect(createAnonymousFirstPolicy(true).run(run, signal)).rejects.toBe(final);
    expect(run.mock.calls).toEqual([["anonymous"], ["api-key"]]);
    expect(final.retryAt).toBeUndefined();
  });

  test.each([undefined, 2_000])(
    "cancels delay %s with original reason and no fallback",
    async (delay) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const reason = new Error("private abort detail");
      const run = vi
        .fn<(route: AuthRoute) => Promise<string>>()
        .mockRejectedValueOnce(
          new AnonymousRateLimitError(
            Date.now(),
            delay === undefined ? undefined : Date.now() + delay,
          ),
        );
      const pending = createAnonymousFirstPolicy(true).run(run, controller.signal);
      const rejected = expect(pending).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(reason);
      await rejected;
      await vi.runAllTimersAsync();
      expect(run).toHaveBeenCalledOnce();
    },
  );

  test("clear removes cooldown", async () => {
    const policy = createAnonymousFirstPolicy(true);
    const run = vi
      .fn<(route: AuthRoute) => Promise<string>>()
      .mockRejectedValueOnce(new AnonymousRateLimitError(Date.now(), Date.now() + 60_000))
      .mockResolvedValue("ok");
    await policy.run(run, signal);
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
