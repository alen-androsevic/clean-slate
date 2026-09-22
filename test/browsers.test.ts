import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrowser, launchArgs } from "../src/browsers";

test("chromium browsers get an isolated user-data-dir", () => {
  const args = launchArgs({ name: "chrome", engine: "chromium", path: "chrome" }, { profileDir: "/p", url: "http://localhost:1" });
  expect(args).toContain("--user-data-dir=/p");
  expect(args.at(-1)).toBe("http://localhost:1");
});

test("firefox gets an isolated profile with first-run prompts disabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-test-"));
  const args = launchArgs({ name: "firefox", engine: "firefox", path: "firefox" }, { profileDir: dir, url: "http://localhost:1", headless: true });
  expect(args).toEqual(["-profile", dir, "-no-remote", "-new-instance", "-headless", "http://localhost:1"]);
  expect(readFileSync(join(dir, "user.js"), "utf8")).toContain("checkDefaultBrowser");
});

test("rejects unknown browser names", () => {
  expect(() => findBrowser("netscape")).toThrow(/Unknown browser/);
});
