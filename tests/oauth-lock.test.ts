import timers from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const secretError = (errcode = 10) =>
  Object.assign(new Error("storage-sentinel", { cause: { token: "storage-sentinel" } }), {
    code: "ERR_SQLITE_ERROR",
    errcode,
  });
let now: number;
let open: ReturnType<typeof vi.fn<() => void>>;
let exec: ReturnType<typeof vi.fn<(sql: string) => void>>;
let close: ReturnType<typeof vi.fn<() => void>>;
let opened: boolean;
let connectionCount: number;
let load: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.resetModules();
  now = 0;
  opened = false;
  connectionCount = 0;
  load = vi.fn();
  open = vi.fn(() => {
    opened = true;
  });
  exec = vi.fn();
  close = vi.fn(() => {
    opened = false;
  });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(timers, "setTimeout").mockImplementation(async (ms) => {
    now += ms ?? 0;
  });
  // Register once per test: Vitest resolves consecutive doMock calls in parallel.
  vi.doMock("node:sqlite", () => {
    load();
    return {
      DatabaseSync: class {
        constructor() {
          connectionCount++;
        }
        get isOpen() {
          return opened;
        }
        open() {
          open();
        }
        exec(sql: string) {
          exec(sql);
        }
        close() {
          close();
        }
      },
    };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("node:sqlite");
  vi.resetModules();
});

describe("OAuth lock acquisition boundaries (L3)", () => {
  test.each([5, 261, 517])(
    "retries numeric primary BUSY %s only, with async waits",
    async (code) => {
      let attempts = 0;
      exec.mockImplementation((sql: string) => {
        if (sql === "BEGIN IMMEDIATE" && ++attempts < 3) throw secretError(code);
      });
      const { withOAuthLock } = await import("../src/oauth-lock.ts");
      expect(await withOAuthLock("unused", async () => "protected")).toBe("protected");
      expect(attempts).toBe(3);
      expect(timers.setTimeout).toHaveBeenCalledTimes(2);
      expect(now).toBe(100);
      expect(exec).toHaveBeenLastCalledWith("ROLLBACK");
      expect(close).toHaveBeenCalledTimes(1);
    },
  );
  test.each([6, 10, 11, 14, 19])(
    "does not retry SQLite code %s or expose its exception",
    async (code) => {
      exec.mockImplementation(() => {
        throw secretError(code);
      });
      const { withOAuthLock } = await import("../src/oauth-lock.ts");
      const operation = vi.fn();
      const error = await withOAuthLock("unused", operation).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "storage" });
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain("storage-sentinel");
      expect(operation).not.toHaveBeenCalled();
      expect(timers.setTimeout).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
    },
  );
  test("does not classify BUSY by text", async () => {
    exec.mockImplementation(() => {
      throw new Error("SQLITE_BUSY storage-sentinel");
    });
    const { withOAuthLock } = await import("../src/oauth-lock.ts");
    await expect(withOAuthLock("unused", vi.fn())).rejects.toMatchObject({ code: "storage" });
    expect(timers.setTimeout).not.toHaveBeenCalled();
  });
  test("budget includes module loading, connection setup and short final polling delay", async () => {
    open.mockImplementation(() => {
      opened = true;
      now += 9_925;
    });
    exec.mockImplementation((sql: string) => {
      if (sql === "BEGIN IMMEDIATE") throw secretError(5);
    });
    const { withOAuthLock } = await import("../src/oauth-lock.ts");
    const operation = vi.fn();
    await expect(withOAuthLock("unused", operation)).rejects.toMatchObject({ code: "storage" });
    expect(vi.mocked(timers.setTimeout).mock.calls.map(([ms]) => ms)).toEqual([50, 25]);
    expect(operation).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
  test("expiration immediately after synchronous acquisition rolls back before entry", async () => {
    exec.mockImplementation((sql: string) => {
      if (sql === "BEGIN IMMEDIATE") now = 10_001;
    });
    const { withOAuthLock } = await import("../src/oauth-lock.ts");
    const operation = vi.fn();
    await expect(withOAuthLock("unused", operation)).rejects.toMatchObject({ code: "storage" });
    expect(operation).not.toHaveBeenCalled();
    expect(exec).toHaveBeenLastCalledWith("ROLLBACK");
    expect(close).toHaveBeenCalledTimes(1);
  });
  test.each(["before", "open", "acquired", "poll"])(
    "preserves abort reason at %s and never enters later",
    async (stage) => {
      const controller = new AbortController();
      const reason = { token: "storage-sentinel" };
      if (stage === "before") controller.abort(reason);
      if (stage === "open")
        open.mockImplementation(() => {
          opened = true;
          controller.abort(reason);
        });
      exec.mockImplementation((sql: string) => {
        if (sql !== "BEGIN IMMEDIATE") return;
        if (stage === "acquired") controller.abort(reason);
        if (stage === "poll") throw secretError(5);
      });
      if (stage === "poll")
        vi.mocked(timers.setTimeout).mockImplementation(async () => {
          controller.abort(reason);
          throw new Error("AbortError");
        });
      const { withOAuthLock } = await import("../src/oauth-lock.ts");
      const operation = vi.fn();
      await expect(withOAuthLock("unused", operation, controller.signal)).rejects.toBe(reason);
      expect(operation).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(stage === "before" ? 0 : 1);
      if (stage === "acquired") expect(exec).toHaveBeenLastCalledWith("ROLLBACK");
    },
  );
  test.each(["rollback", "close", "both"])(
    "reports %s cleanup failure safely and attempts close",
    async (stage) => {
      if (stage !== "close")
        exec.mockImplementation((sql: string) => {
          if (sql === "ROLLBACK") throw secretError();
        });
      if (stage !== "rollback")
        close.mockImplementation(() => {
          throw secretError();
        });
      const { withOAuthLock } = await import("../src/oauth-lock.ts");
      await expect(withOAuthLock("unused", async () => "already committed")).rejects.toMatchObject({
        code: "storage",
      });
      expect(close).toHaveBeenCalledTimes(1);
    },
  );
  test("module unavailability and loading time cannot enter protected work", async () => {
    load.mockImplementation(() => {
      throw secretError();
    });
    const { withOAuthLock } = await import("../src/oauth-lock.ts");
    const operation = vi.fn();
    await expect(withOAuthLock("unused", operation)).rejects.toMatchObject({ code: "storage" });
    expect(operation).not.toHaveBeenCalled();
    expect(connectionCount).toBe(0);
  });
  test("module loading counts towards the deadline", async () => {
    load.mockImplementation(() => {
      now = 10_000;
    });
    const { withOAuthLock } = await import("../src/oauth-lock.ts");
    const operation = vi.fn();
    await expect(withOAuthLock("unused", operation)).rejects.toMatchObject({ code: "storage" });
    expect(operation).not.toHaveBeenCalled();
    expect(connectionCount).toBe(0);
  });
  test("acquisition deadline is not an ownership lease", async () => {
    const { withOAuthLock } = await import("../src/oauth-lock.ts");
    expect(
      await withOAuthLock("unused", async () => {
        now = 60_000;
        await Promise.resolve();
        return "committed";
      }),
    ).toBe("committed");
    expect(exec).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
