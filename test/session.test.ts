import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, removeSession, sweepStaleSessions } from "../src/session";

test("creates and removes a session", async () => {
  const root = mkdtempSync(join(tmpdir(), "cs-test-"));
  const session = createSession(root);
  expect(existsSync(session.profileDir)).toBe(true);
  expect(await removeSession(session)).toBe(true);
  expect(existsSync(session.dir)).toBe(false);
});

test("sweeps sessions whose owner is gone, keeps live ones", () => {
  const root = mkdtempSync(join(tmpdir(), "cs-test-"));
  const live = createSession(root);
  expect(sweepStaleSessions(root)).toEqual([]);

  const dead = join(root, "dead");
  mkdirSync(dead);
  writeFileSync(join(dead, "owner.pid"), "999999"); // no such process
  expect(sweepStaleSessions(root)).toEqual(["dead"]);
  expect(existsSync(live.dir)).toBe(true);
});
