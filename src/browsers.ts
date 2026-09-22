import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type Engine = "chromium" | "firefox";

export interface Browser {
  name: string;
  engine: Engine;
  path: string;
}

interface Candidate {
  name: string;
  engine: Engine;
  /** macOS: path inside /Applications or ~/Applications. */
  mac: string;
  /** Linux: executable names looked up on PATH. */
  linux: string[];
}

// Order is the default preference when no browser is requested.
const CANDIDATES: Candidate[] = [
  {
    name: "chrome",
    engine: "chromium",
    mac: "Google Chrome.app/Contents/MacOS/Google Chrome",
    linux: ["google-chrome", "google-chrome-stable"],
  },
  {
    name: "chromium",
    engine: "chromium",
    mac: "Chromium.app/Contents/MacOS/Chromium",
    linux: ["chromium", "chromium-browser"],
  },
  {
    name: "brave",
    engine: "chromium",
    mac: "Brave Browser.app/Contents/MacOS/Brave Browser",
    linux: ["brave-browser", "brave"],
  },
  {
    name: "edge",
    engine: "chromium",
    mac: "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    linux: ["microsoft-edge", "microsoft-edge-stable"],
  },
  {
    name: "firefox",
    engine: "firefox",
    mac: "Firefox.app/Contents/MacOS/firefox",
    linux: ["firefox"],
  },
];

export const BROWSER_NAMES = CANDIDATES.map((c) => c.name);

function locate(candidate: Candidate, platform: NodeJS.Platform): string | null {
  const paths =
    platform === "darwin"
      ? ["/Applications", join(homedir(), "Applications")].map((dir) => join(dir, candidate.mac))
      : candidate.linux.map((bin) => Bun.which(bin)).filter((p): p is string => !!p);
  return paths.find((p) => existsSync(p)) ?? null;
}

/**
 * Resolves a browser by name (chrome, firefox, ...), by executable path, or the first installed one.
 * Throws with a helpful message when nothing usable is found.
 */
export function findBrowser(requested?: string, platform = process.platform): Browser {
  if (requested?.includes("/")) {
    if (!existsSync(requested)) throw new Error(`Browser executable not found: ${requested}`);
    const engine: Engine = basename(requested).toLowerCase().includes("firefox") ? "firefox" : "chromium";
    return { name: basename(requested), engine, path: requested };
  }

  const wanted = requested?.toLowerCase();
  if (wanted && !BROWSER_NAMES.includes(wanted)) {
    throw new Error(`Unknown browser "${requested}". Use one of: ${BROWSER_NAMES.join(", ")}, or a path to an executable.`);
  }

  for (const candidate of CANDIDATES) {
    if (wanted && candidate.name !== wanted) continue;
    const path = locate(candidate, platform);
    if (path) return { name: candidate.name, engine: candidate.engine, path };
  }

  throw new Error(
    wanted
      ? `Browser "${wanted}" is not installed (or not where clean-slate looks). Pass --browser <path> instead.`
      : `No supported browser found (${BROWSER_NAMES.join(", ")}). Pass --browser <path>.`,
  );
}

export interface LaunchOptions {
  profileDir: string;
  url: string;
  headless?: boolean;
}

/** Command-line arguments that make the browser keep all of its state in `profileDir`. */
export function launchArgs(browser: Browser, { profileDir, url, headless }: LaunchOptions): string[] {
  if (browser.engine === "firefox") {
    // Skip first-run pages and default-browser prompts in the fresh profile.
    writeFileSync(
      join(profileDir, "user.js"),
      [
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.aboutwelcome.enabled", false);',
        'user_pref("browser.startup.homepage_override.mstone", "ignore");',
        'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
        'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
      ].join("\n") + "\n",
    );
    return ["-profile", profileDir, "-no-remote", "-new-instance", ...(headless ? ["-headless"] : []), url];
  }

  return [
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    ...(headless ? ["--headless=new"] : []),
    url,
  ];
}
