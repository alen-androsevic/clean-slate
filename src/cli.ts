#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Subprocess } from "bun";
import { BROWSER_NAMES, findBrowser, launchArgs, type Browser } from "./browsers";
import { expoApps, wipeNativeApps, type NativeApps, type WipeOptions } from "./native";
import { createSession, removeSession } from "./session";
import { findDevUrl, waitForListening } from "./url";

const USAGE = `clean-slate: run a dev server with a throwaway browser profile and wiped native app data

Usage:
  clean-slate [options] <script>          runs \`bun run <script>\` from package.json
  clean-slate [options] <command> [args]  runs any command, e.g. clean-slate vite --port 4000

Options:
  --url <url>         open this URL instead of detecting it from the server output
  --browser <name>    ${BROWSER_NAMES.join(" | ")} | <path>  (env: CLEAN_SLATE_BROWSER)
  --app-id <id>       native bundle id / package to wipe (repeatable; Expo projects are detected)
  --no-native         don't touch simulators or devices
  --reset-keychain    also reset the iOS simulator keychain (SecureStore); simulator-wide
  --timeout <sec>     how long to wait for the dev server (default 60)
  --headless          run the browser headless
  --keep              keep the browser session and native app data on exit (for debugging)
  -h, --help          show this help

Set CLEAN_SLATE=0 to run the command without any of this (e.g. in CI).`;

const log = (msg: string) => process.stderr.write(`\x1b[2m[clean-slate]\x1b[22m ${msg}\r\n`);

function parse() {
  // Our options come first; everything from the first positional on belongs to the wrapped command.
  const argv = Bun.argv.slice(2);
  const { values, tokens } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      browser: { type: "string" },
      "app-id": { type: "string", multiple: true },
      "no-native": { type: "boolean" },
      "reset-keychain": { type: "boolean" },
      timeout: { type: "string" },
      headless: { type: "boolean" },
      keep: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
    tokens: true,
  });
  const first = tokens.find((t) => t.kind === "positional" || t.kind === "option-terminator");
  const command = first ? argv.slice(first.kind === "option-terminator" ? first.index + 1 : first.index) : [];
  return { values, command };
}

/** A lone word that names a package.json script becomes `bun run <script>`. */
function resolveCommand(command: string[]): string[] {
  if (command.length !== 1 || !existsSync("package.json")) return command;
  try {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
    if (command[0]! in scripts) return [process.execPath, "run", command[0]!];
  } catch {}
  return command;
}

async function resolveNativeApps(appIds: string[], disabled: boolean): Promise<NativeApps | null> {
  if (disabled) return null;
  const apps = (await expoApps()) ?? { ios: [], android: [] };
  apps.ios.push(...appIds);
  apps.android.push(...appIds);
  if (apps.expoGo) log("Expo Go is never wiped (its data is shared with other projects); use a development build for a clean native slate");
  return apps.ios.length || apps.android.length ? apps : null;
}

async function wipeNative(apps: NativeApps | null, when: string, options: WipeOptions) {
  if (!apps) return;
  const wiped = await wipeNativeApps(apps, options);
  const all = [...wiped.ios, ...wiped.android];
  if (all.length) log(`${when}: wiped ${all.join(", ")}`);
  if (wiped.ios.length && !options.resetKeychain && when === "fresh start") {
    log("iOS keychain (SecureStore) kept; pass --reset-keychain to reset it too (simulator-wide)");
  }
}

/** Signals a process's whole group (the dev server leads its own), falling back to the process itself. */
function stop(proc: Subprocess | undefined, signal: NodeJS.Signals) {
  if (!proc) return;
  try {
    process.kill(-proc.pid, signal);
  } catch {
    if (proc.exitCode === null && !proc.signalCode) proc.kill(signal);
  }
}

async function main() {
  if (typeof Bun.Terminal !== "function") {
    throw new Error(`Bun ${Bun.version} has no pseudo-terminal support, which clean-slate needs. Run \`bun upgrade\`.`);
  }
  const { values, command: rawCommand } = parse();
  if (values.help || rawCommand.length === 0) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const command = resolveCommand(rawCommand);

  if (process.env.CLEAN_SLATE === "0") {
    const proc = Bun.spawn(command, { stdio: ["inherit", "inherit", "inherit"] });
    process.exit(await proc.exited);
  }

  const native = await resolveNativeApps((values["app-id"] as string[] | undefined) ?? [], !!values["no-native"]);
  // Without a browser we can still do the native side; for web-only projects fail fast.
  let browser: Browser | undefined;
  try {
    browser = findBrowser((values.browser as string | undefined) ?? process.env.CLEAN_SLATE_BROWSER);
  } catch (err) {
    if (!native) throw err;
    log(`${(err as Error).message} Continuing without a web session.`);
  }

  const wipeOptions: WipeOptions = { resetKeychain: !!values["reset-keychain"] };
  const session = createSession();
  await wipeNative(native, "fresh start", wipeOptions);

  let tail = "";
  let resolveUrl!: (url: string) => void;
  const urlFound = new Promise<string>((r) => (resolveUrl = r));
  if (values.url) resolveUrl(values.url as string);
  const decoder = new TextDecoder();

  // Run the server in a pseudo-terminal: interactive CLIs (Expo, Vite, ...) keep their UI and
  // key shortcuts, and we can still read the output to find the URL.
  const server = Bun.spawn(command, {
    env: {
      ...process.env,
      // Stop Vite, CRA, Expo & co. from opening the user's normal browser profile.
      BROWSER: "none",
      CLEAN_SLATE_SESSION: session.id,
    },
    terminal: {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      data(_terminal, data) {
        process.stdout.write(data);
        tail = (tail + decoder.decode(data, { stream: true })).slice(-4096);
        const url = findDevUrl(tail);
        if (url) resolveUrl(url);
      },
    },
  });

  let browserProc: Subprocess | undefined;
  let shuttingDown = false;
  const shutdown = async (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    stop(browserProc, "SIGTERM");
    stop(server, "SIGTERM");
    const exits = [server.exited, browserProc?.exited].filter(Boolean);
    const settled = await Promise.race([Promise.all(exits).then(() => true), Bun.sleep(5000).then(() => false)]);
    if (!settled) {
      stop(server, "SIGKILL");
      stop(browserProc, "SIGKILL");
    }
    if (values.keep) {
      log(`session kept at ${session.dir}; native app data left as is`);
    } else {
      await wipeNative(native, "cleanup", wipeOptions);
      if (!(await removeSession(session))) log(`could not fully remove ${session.dir}; it will be swept next run`);
    }
    process.exit(code);
  };

  // Our terminal is in raw mode, so Ctrl+C arrives as a byte and goes to the server like any other key.
  // A second Ctrl+C means the server didn't stop on its own: shut everything down.
  let interrupts = 0;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("data", (data: Buffer) => {
    server.terminal?.write(data);
    if (data.includes(0x03) && ++interrupts >= 2) shutdown(130);
  });
  process.stdout.on("resize", () => server.terminal?.resize(process.stdout.columns, process.stdout.rows));
  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));
  process.on("SIGHUP", () => shutdown(129));
  server.exited.then((code) => shutdown(code ?? 1));

  if (!browser) return;
  const timeoutMs = Number(values.timeout ?? 60) * 1000;
  const deadline = Date.now() + timeoutMs;
  const url = await Promise.race([urlFound, Bun.sleep(timeoutMs).then(() => null)]);
  if (!url) {
    // Native-only projects (e.g. Expo without web) never print a web URL; that's fine.
    if (!native) log(`no dev-server URL seen in ${timeoutMs / 1000}s; pass --url to open the browser.`);
    return;
  }
  if (!(await waitForListening(url, deadline))) {
    log(`${url} did not respond in time; not opening the browser.`);
    return;
  }
  if (shuttingDown) return;

  browserProc = Bun.spawn([browser.path, ...launchArgs(browser, { profileDir: session.profileDir, url, headless: !!values.headless })], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  log(`fresh ${browser.name} session ${session.id} → ${url}`);
  browserProc.exited.then(() => {
    if (!shuttingDown) log("browser closed; its session is wiped when the dev server stops");
  });
}

main().catch((err) => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  log(`\x1b[31m${err instanceof Error ? err.message : err}\x1b[39m`);
  process.exit(1);
});
