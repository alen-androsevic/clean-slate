import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Native app identifiers whose data is wiped on connected simulators/devices. */
export interface NativeApps {
  ios: string[];
  android: string[];
  /** The project can run in Expo Go (no dev client). Expo Go's storage is shared with other projects, so it's left alone. */
  expoGo?: boolean;
}

export interface WipeOptions {
  /** Also reset the simulator keychain (SecureStore). It is simulator-wide, so opt-in. */
  resetKeychain?: boolean;
}

/** What was wiped, as "<app> on <device>" per platform. */
export interface Wiped {
  ios: string[];
  android: string[];
}

async function run(cmd: string[], cwd?: string): Promise<{ ok: boolean; stdout: string }> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: 30_000 });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { ok: code === 0, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * The native apps an Expo project runs as: its own bundle id / package. Without a dev client the
 * project may also run in Expo Go, which is flagged but never wiped. Returns null for non-Expo projects.
 */
export async function expoApps(cwd = process.cwd()): Promise<NativeApps | null> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.expo) return null;

  const config = await readExpoConfig(cwd);
  const apps: NativeApps = { ios: [], android: [], expoGo: !deps["expo-dev-client"] };
  if (config?.ios?.bundleIdentifier) apps.ios.push(config.ios.bundleIdentifier);
  if (config?.android?.package) apps.android.push(config.android.package);
  return apps;
}

interface ExpoConfig {
  ios?: { bundleIdentifier?: string };
  android?: { package?: string };
}

/** Evaluated config via the project's Expo CLI (handles app.config.js/ts), falling back to app.json. */
async function readExpoConfig(cwd: string): Promise<ExpoConfig | null> {
  const bin = join(cwd, "node_modules", ".bin", "expo");
  if (existsSync(bin)) {
    const { ok, stdout } = await run([bin, "config", "--json", "--type", "public"], cwd);
    if (ok) {
      try {
        return JSON.parse(stdout.slice(stdout.indexOf("{")));
      } catch {}
    }
  }
  try {
    return JSON.parse(readFileSync(join(cwd, "app.json"), "utf8")).expo ?? null;
  } catch {
    return null;
  }
}

/** Wipes the apps' data on every booted iOS simulator and connected Android device. */
export async function wipeNativeApps(apps: NativeApps, options: WipeOptions = {}): Promise<Wiped> {
  const [ios, android] = await Promise.all([wipeIos(apps.ios, options), wipeAndroid(apps.android)]);
  return { ios, android };
}

// --- iOS simulator -----------------------------------------------------------

async function bootedSimulators(): Promise<{ udid: string; name: string }[]> {
  if (process.platform !== "darwin" || !Bun.which("xcrun")) return [];
  const { ok, stdout } = await run(["xcrun", "simctl", "list", "devices", "booted", "-j"]);
  if (!ok) return [];
  try {
    const devices: Record<string, { udid: string; name: string; state: string }[]> = JSON.parse(stdout).devices;
    return Object.values(devices)
      .flat()
      .filter((d) => d.state === "Booted");
  } catch {
    return [];
  }
}

async function wipeIos(bundleIds: string[], { resetKeychain }: WipeOptions): Promise<string[]> {
  if (bundleIds.length === 0) return [];
  const wiped: string[] = [];
  for (const sim of await bootedSimulators()) {
    let any = false;
    for (const id of bundleIds) {
      if (await wipeSimulatorApp(sim.udid, id)) {
        wiped.push(`${id} on ${sim.name}`);
        any = true;
      }
    }
    // SecureStore lives in the keychain, outside the app container. The simulator only offers a
    // keychain-wide reset (which also drops trusted root certs), hence opt-in.
    if (any && resetKeychain) await run(["xcrun", "simctl", "keychain", sim.udid, "reset"]);
  }
  return wiped;
}

// Directories inside an app's data container that iOS creates at install time.
const CONTAINER_SKELETON = ["Documents", "Library", "Library/Caches", "Library/Preferences", "tmp"];

/** The equivalent of Android's `pm clear`: empty data container, preferences and permissions. */
async function wipeSimulatorApp(udid: string, bundleId: string): Promise<boolean> {
  const container = await run(["xcrun", "simctl", "get_app_container", udid, bundleId, "data"]);
  if (!container.ok) return false; // not installed on this simulator

  await run(["xcrun", "simctl", "terminate", udid, bundleId]);
  // Goes through cfprefsd, which would otherwise keep serving cached NSUserDefaults.
  await run(["xcrun", "simctl", "spawn", udid, "defaults", "delete", bundleId]);
  await run(["xcrun", "simctl", "privacy", udid, "reset", "all", bundleId]);

  const dir = container.stdout.trim();
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".com.apple.mobile_container_manager")) continue;
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
  for (const sub of CONTAINER_SKELETON) mkdirSync(join(dir, sub), { recursive: true });
  return true;
}

// --- Android -----------------------------------------------------------------

function findAdb(): string | null {
  const onPath = Bun.which("adb");
  if (onPath) return onPath;
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk"),
  ];
  for (const root of sdkRoots) {
    const adb = root && join(root, "platform-tools", "adb");
    if (adb && existsSync(adb)) return adb;
  }
  return null;
}

async function wipeAndroid(packages: string[]): Promise<string[]> {
  const adb = packages.length > 0 ? findAdb() : null;
  if (!adb) return [];
  const { ok, stdout } = await run([adb, "devices"]);
  if (!ok) return [];
  const serials = stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial!);

  const wiped: string[] = [];
  for (const serial of serials) {
    for (const pkg of packages) {
      // Clears data, cache and runtime permissions; prints "Success" only when the package exists.
      const res = await run([adb, "-s", serial, "shell", "pm", "clear", pkg]);
      if (res.stdout.includes("Success")) wiped.push(`${pkg} on ${serial}`);
    }
  }
  return wiped;
}
