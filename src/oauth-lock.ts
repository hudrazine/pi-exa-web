import timers from "node:timers/promises";
import type { DatabaseSync as Database } from "node:sqlite";
import { ExaError } from "./errors.ts";

// Each invocation owns a connection, including concurrent calls in one process.
export async function withOAuthLock<T>(
  path: string,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const deadline = performance.now() + 10_000;
  let db: Database | undefined;
  let acquired = false;
  let failed = false;
  let failure: unknown;
  let result: { value: T } | undefined;
  const check = () => {
    signal?.throwIfAborted();
    if (performance.now() >= deadline) throw new ExaError("storage");
  };
  try {
    check();
    const { DatabaseSync } = await import("node:sqlite");
    check();
    // Retain the handle even when open() fails so cleanup can still run.
    db = new DatabaseSync(path, { open: false });
    check();
    db.open();
    check();
    db.exec("PRAGMA busy_timeout=0");
    check();
    while (!acquired) {
      try {
        db.exec("BEGIN IMMEDIATE");
        acquired = true;
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ERR_SQLITE_ERROR" ||
          !("errcode" in error) ||
          typeof error.errcode !== "number" ||
          (error.errcode & 0xff) !== 5
        )
          throw error;
        check();
        await timers.setTimeout(Math.min(50, deadline - performance.now()), undefined, { signal });
      }
      check();
    }
    result = { value: await operation() };
  } catch (error) {
    failed = true;
    failure = signal?.aborted ? signal.reason : storageError(error);
  } finally {
    if (db?.isOpen) {
      try {
        if (acquired) db.exec("ROLLBACK");
      } catch {
        if (!failed) {
          failed = true;
          failure = new ExaError("storage");
        }
      } finally {
        try {
          db.close();
        } catch {
          if (!failed) {
            failed = true;
            failure = new ExaError("storage");
          }
        }
      }
    }
  }
  if (failed || !result) throw failure;
  return result.value;
}

export function storageError(error: unknown): ExaError {
  return new ExaError(
    error instanceof ExaError && error.code === "storage-conflict" ? "storage-conflict" : "storage",
  );
}
