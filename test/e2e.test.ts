import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { findBrowser } from "../src/browsers";
import { SESSIONS_ROOT } from "../src/session";

const CLI = join(import.meta.dir, "../src/cli.ts");
const FIXTURE = join(import.meta.dir, "fixtures/storage-server.ts");

let hasBrowser = true;
try {
  findBrowser(process.env.CLEAN_SLATE_BROWSER);
} catch {
  hasBrowser = false;
}

async function run() {
  const proc = Bun.spawn([process.execPath, CLI, "--headless", process.execPath, FIXTURE], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const report = out.match(/REPORT (.*)/)?.[1];
  if (!report) throw new Error(`no report (exit ${code})\n${out}\n${err}`);
  return { code, seen: JSON.parse(report), session: err.match(/session (\S+)/)?.[1] };
}

test.skipIf(!hasBrowser)(
  "each run starts with empty storage and leaves nothing behind",
  async () => {
    const first = await run();
    const second = await run();

    for (const { code, seen, session } of [first, second]) {
      expect(code).toBe(0);
      expect(seen).toEqual({ local: null, session: null, cookie: "" });
      expect(readdirSync(SESSIONS_ROOT)).not.toContain(session);
    }
  },
  60_000,
);
