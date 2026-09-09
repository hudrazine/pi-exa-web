import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ExaError } from "./errors.ts";
import { storageError, withOAuthLock } from "./oauth-lock.ts";
import {
  parseOAuth,
  parseSettings,
  type Credentials,
  type OAuthState,
  type Settings,
} from "./state-schema.ts";

// No directory override or cache: Pi owns the directory, JSON owns committed state.
export function createStateStore() {
  const root = join(getAgentDir(), "exa-web");
  async function directory(write: boolean): Promise<string> {
    if (write) await fs.mkdir(root, { recursive: true, mode: 0o700 });
    return fs.realpath(root);
  }
  async function read<T>(name: string, parse: (value: unknown) => T, fallback: T): Promise<T> {
    let content: string;
    try {
      content = await fs.readFile(join(await directory(false), name), "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return fallback;
      throw error;
    }
    return parse(JSON.parse(content));
  }
  const readSettings = () =>
    boundary(() =>
      read("settings.json", parseSettings, { version: 1, strategy: "anonymous-first" }),
    );
  const readOAuth = () =>
    boundary(() => read("oauth.json", parseOAuth, { version: 1, revision: 0, credentials: null }));
  return {
    readSettings,
    readOAuth,
    writeSettings(value: Settings, signal?: AbortSignal): Promise<Settings> {
      return boundary(async () => {
        signal?.throwIfAborted();
        const next = parseSettings(value);
        await readSettings();
        signal?.throwIfAborted();
        await replace(join(await directory(true), "settings.json"), next, signal);
        return next;
      }, signal);
    },
    updateOAuth(
      update: (latest: OAuthState) => Promise<Credentials | null | undefined>,
      options: { signal?: AbortSignal; expectedRevision?: number } = {},
    ): Promise<OAuthState> {
      return boundary(async () => {
        options.signal?.throwIfAborted();
        const dir = await directory(true);
        await restrictedDirectory(dir);
        return withOAuthLock(
          join(dir, "oauth.lock.sqlite"),
          async () => {
            const latest = await readOAuth();
            options.signal?.throwIfAborted();
            if (
              options.expectedRevision !== undefined &&
              options.expectedRevision !== latest.revision
            )
              throw new ExaError("storage-conflict");
            const revision = latest.revision;
            const credentials = await update(structuredClone(latest));
            options.signal?.throwIfAborted();
            if (credentials === undefined) return latest;
            const next = parseOAuth({ version: 1, revision: revision + 1, credentials });
            await replace(join(dir, "oauth.json"), next, options.signal);
            return next;
          },
          options.signal,
        );
      }, options.signal);
    },
  };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
async function boundary<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw signal?.aborted ? signal.reason : storageError(error);
  }
}
async function restrictedDirectory(path: string): Promise<void> {
  const info = await fs.stat(path);
  if (!info.isDirectory() || (process.platform !== "win32" && (info.mode & 0o777) !== 0o700))
    throw new ExaError("storage");
}
async function replace(path: string, value: unknown, signal?: AbortSignal): Promise<void> {
  await restrictedDirectory(dirname(path));
  // Refuse insecure existing secret files; replacement is not a permission-repair command.
  try {
    const info = await fs.lstat(path);
    if (!info.isFile() || (process.platform !== "win32" && (info.mode & 0o777) !== 0o600))
      throw new ExaError("storage");
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  let owned = false;
  try {
    signal?.throwIfAborted();
    handle = await fs.open(temporary, "wx", 0o600);
    owned = true;
    const info = await handle.stat();
    if (process.platform !== "win32" && (info.mode & 0o777) !== 0o600)
      throw new ExaError("storage");
    signal?.throwIfAborted();
    await handle.writeFile(JSON.stringify(value) + "\n", { encoding: "utf8", signal });
    await handle.close();
    handle = undefined;
    signal?.throwIfAborted();
    // Successful rename is the commit point. Do not report a later abort as a failed write.
    await fs.rename(temporary, path);
    owned = false;
  } finally {
    try {
      await handle?.close();
    } finally {
      if (owned) await fs.unlink(temporary);
    }
  }
}
