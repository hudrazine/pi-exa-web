import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "pi-exa-command-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

async function load() {
  const loaded = await discoverAndLoadExtensions([resolvePath("src/index.ts")], dir, dir);
  expect(loaded.errors).toEqual([]);
  const extension = loaded.extensions[0];
  expect([...extension.commands.keys()]).toEqual(["exa"]);
  expect([...extension.tools.keys()]).toEqual(["web_search", "web_fetch"]);
  expect([...extension.handlers.keys()]).toEqual(["session_shutdown"]);
  const notify = vi.fn();
  return {
    extension,
    notify,
    command: (args: string): Promise<void> =>
      Reflect.apply(extension.commands.get("exa")!.handler, undefined, [args, { ui: { notify } }]),
    close: async () => {
      for (const handler of extension.handlers.get("session_shutdown")!)
        await Reflect.apply(handler, undefined, [{}, {}]);
    },
  };
}

test("strategy command validates before saving and reports only committed settings without network or SQLite", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network"));
  const { command, notify, close } = await load();
  await command("strategy");
  expect(notify).toHaveBeenLastCalledWith("Exa strategy: anonymous-first", "info");
  expect(await fs.readdir(dir)).not.toContain("exa-web");
  for (const args of [
    "",
    "strategy SECRET",
    "strategy authenticated-first extra",
    "login",
    "status",
    "logout",
  ]) {
    notify.mockClear();
    await command(args);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Usage: /exa strategy [anonymous-first|authenticated-first]",
      "info",
    );
    expect(await fs.readdir(dir)).not.toContain("exa-web");
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const beforeRename = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const rename = fs.rename;
  const replacing = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    entered();
    await gate;
    return rename(from, to);
  });
  notify.mockClear();
  const pending = command("strategy authenticated-first");
  await beforeRename;
  expect(notify).not.toHaveBeenCalled();
  await expect(fs.readFile(join(dir, "exa-web/settings.json"), "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  release();
  await pending;
  expect(notify).toHaveBeenCalledExactlyOnceWith("Exa strategy: authenticated-first", "info");
  expect(JSON.parse(await fs.readFile(join(dir, "exa-web/settings.json"), "utf8"))).toEqual({
    version: 1,
    strategy: "authenticated-first",
  });
  expect(await fs.readdir(join(dir, "exa-web"))).toEqual(["settings.json"]);
  replacing.mockRestore();
  await command("strategy");
  expect(notify).toHaveBeenLastCalledWith("Exa strategy: authenticated-first", "info");
  await close();
  await command("strategy anonymous-first");
  expect(notify).toHaveBeenLastCalledWith("pi-exa-web MCP client is closed", "error");
  expect(network).not.toHaveBeenCalled();
});

test("failed settings replacement preserves the previous strategy and notifies a safe error", async () => {
  const { command, notify, close } = await load();
  await command("strategy authenticated-first");
  const previous = await fs.readFile(join(dir, "exa-web/settings.json"), "utf8");
  const replacing = vi
    .spyOn(fs, "rename")
    .mockRejectedValue(new Error("SECRET path", { cause: new Error("SECRET nested") }));
  notify.mockClear();
  await command("strategy anonymous-first");
  expect(notify).toHaveBeenCalledExactlyOnceWith(
    "Could not read or save Exa settings or credentials.",
    "error",
  );
  expect(inspect(notify.mock.calls, { depth: 10 })).not.toContain("SECRET");
  expect(await fs.readFile(join(dir, "exa-web/settings.json"), "utf8")).toBe(previous);
  expect(await fs.readdir(join(dir, "exa-web"))).toEqual(["settings.json"]);
  replacing.mockRestore();
  await command("strategy");
  expect(notify).toHaveBeenLastCalledWith("Exa strategy: authenticated-first", "info");
  await close();
});

test("shutdown interrupts a strategy write before replacement", async () => {
  const { command, notify, close } = await load();
  await command("strategy anonymous-first");
  const previous = await fs.readFile(join(dir, "exa-web/settings.json"), "utf8");
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let entered!: () => void;
  const opened = new Promise<void>((done) => {
    entered = done;
  });
  const open = fs.open;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    entered();
    await gate;
    return handle;
  });
  notify.mockClear();
  const pending = command("strategy authenticated-first");
  await opened;
  await close();
  release();
  await pending;
  expect(notify).toHaveBeenCalledExactlyOnceWith("pi-exa-web MCP client is closed", "error");
  expect(await fs.readFile(join(dir, "exa-web/settings.json"), "utf8")).toBe(previous);
  expect(await fs.readdir(join(dir, "exa-web"))).toEqual(["settings.json"]);
});

test("corrupt settings fail both tools before network and cannot be overwritten by commands", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network"));
  const { command, notify, extension, close } = await load();
  await fs.mkdir(join(dir, "exa-web"), { mode: 0o700 });
  const text = '{"version":999,"strategy":"SECRET","url":"https://user:SECRET@example.test"}';
  await fs.writeFile(join(dir, "exa-web/settings.json"), text, { mode: 0o600 });
  for (const name of ["web_search", "web_fetch"]) {
    const tool = extension.tools.get(name)!.definition;
    const error: unknown = await Reflect.apply(Reflect.get(tool, "execute"), tool, [
      "fixture",
      name === "web_search" ? { query: "q" } : { url: "https://example.test" },
      undefined,
      undefined,
      {},
    ]).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "storage" });
    expect(error).not.toHaveProperty("cause");
    expect(inspect(error, { depth: 10, showHidden: true })).not.toContain("SECRET");
  }
  await command("strategy");
  await command("strategy anonymous-first");
  expect(notify.mock.calls).toEqual([
    ["Could not read or save Exa settings or credentials.", "error"],
    ["Could not read or save Exa settings or credentials.", "error"],
  ]);
  expect(await fs.readFile(join(dir, "exa-web/settings.json"), "utf8")).toBe(text);
  expect(network).not.toHaveBeenCalled();
  await close();
});
