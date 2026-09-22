// Strips ANSI escapes: dev servers colour the port (e.g. Vite prints `localhost:\e[1m5173\e[22m/`).
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// Loopback hosts plus private LAN addresses (Expo, `vite --host`, ...). Non-http schemes like exp:// don't match.
const LOCAL_URL = new RegExp(
  String.raw`https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[a-z0-9-]+\.localhost` +
    String.raw`|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})` +
    String.raw`(?::\d+)?(?:/[^\s'"\x60)<>]*)?`,
  "i",
);

/** Finds the first local or LAN dev-server URL in a chunk of server output. */
export function findDevUrl(text: string): string | null {
  const match = text.replace(ANSI, "").match(LOCAL_URL);
  if (!match) return null;
  return match[0]
    .replace("0.0.0.0", "localhost")
    .replace(/\[::\]/, "localhost")
    .replace(/[.,;:]+$/, "");
}

/**
 * Polls until the URL's host accepts TCP connections, or the deadline passes. A connection is
 * enough: an HTTP request could take seconds on servers that compile on first request (Expo, Next).
 */
export async function waitForListening(url: string, deadline: number): Promise<boolean> {
  const { protocol, hostname, port } = new URL(url);
  const target = {
    hostname: hostname.replace(/^\[|\]$/g, ""),
    port: Number(port) || (protocol === "https:" ? 443 : 80),
  };
  while (Date.now() < deadline) {
    try {
      const socket = await Bun.connect({ ...target, socket: { data() {} } });
      socket.end();
      return true;
    } catch {
      await Bun.sleep(250);
    }
  }
  return false;
}
