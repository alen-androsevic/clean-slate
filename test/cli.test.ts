import { expect, test } from "bun:test";
import { join } from "node:path";
import pkg from "../package.json";

const CLI = join(import.meta.dir, "../src/cli.ts");

async function cli(...args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], { env: { ...process.env, CLEAN_SLATE: "0" }, stdout: "pipe" });
  return (await new Response(proc.stdout).text()).trim();
}

test("options after the command belong to the command", async () => {
  expect(await cli("--headless", "echo", "hi", "--help", "-v", "--url", "x")).toBe("hi --help -v --url x");
  expect(await cli("--", "echo", "-v")).toBe("-v");
});

test("prints its version", async () => {
  expect(await cli("--version")).toBe(pkg.version);
});
