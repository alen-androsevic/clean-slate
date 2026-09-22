import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SESSIONS_ROOT = join(tmpdir(), "clean-slate");
const OWNER_FILE = "owner.pid";

export interface Session {
  id: string;
  dir: string;
  /** Browser profile directory: everything the browser persists lands here. */
  profileDir: string;
}

export function createSession(root = SESSIONS_ROOT): Session {
  sweepStaleSessions(root);
  const id = `${Date.now().toString(36)}-${process.pid}`;
  const dir = join(root, id);
  const profileDir = join(dir, "profile");
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(dir, OWNER_FILE), String(process.pid));
  return { id, dir, profileDir };
}

/** Deletes the session. Retries because the browser may still be writing to its profile as it exits. */
export async function removeSession(session: Session): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(session.dir, { recursive: true, force: true });
      if (!existsSync(session.dir)) return true;
    } catch {}
    await Bun.sleep(200);
  }
  return false;
}

/** Removes sessions left behind by runs that crashed or were killed hard. */
export function sweepStaleSessions(root = SESSIONS_ROOT): string[] {
  if (!existsSync(root)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    let owner = NaN;
    try {
      owner = Number(readFileSync(join(dir, OWNER_FILE), "utf8"));
    } catch {}
    if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      removed.push(entry);
    } catch {}
  }
  return removed;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
