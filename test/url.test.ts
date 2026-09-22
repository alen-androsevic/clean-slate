import { expect, test } from "bun:test";
import { findDevUrl, waitForListening } from "../src/url";

test.each([
  ["  ➜  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m", "http://localhost:5173/"],
  ["ready - started server on 0.0.0.0:3000, url: http://localhost:3000", "http://localhost:3000"],
  ["Listening on http://0.0.0.0:8080.", "http://localhost:8080"],
  ["Server at https://127.0.0.1:4433/app", "https://127.0.0.1:4433/app"],
  ["open http://[::]:9000/", "http://localhost:9000/"],
  ["see http://myapp.localhost:1355/", "http://myapp.localhost:1355/"],
  ["Waiting on http://192.168.1.23:8081", "http://192.168.1.23:8081"],
  ["Network: http://10.0.0.5:5173/", "http://10.0.0.5:5173/"],
  ["Network: http://172.20.1.2:3000/", "http://172.20.1.2:3000/"],
  ["› Metro waiting on exp://192.168.1.23:8081\n› Web is waiting on http://localhost:8081", "http://localhost:8081"],
])("finds %p", (input, expected) => {
  expect(findDevUrl(input)).toBe(expected);
});

test("ignores non-local URLs", () => {
  expect(findDevUrl("docs at https://vitejs.dev/config")).toBeNull();
  expect(findDevUrl("public http://172.32.0.1:80/ and http://8.8.8.8/")).toBeNull();
  expect(findDevUrl("› Metro waiting on exp://192.168.1.23:8081")).toBeNull();
});

test("waits until the port accepts connections, without making a request", async () => {
  let requests = 0;
  const server = Bun.serve({ port: 0, fetch: () => (requests++, new Response("ok")) });
  const url = `http://localhost:${server.port}/`;
  expect(await waitForListening(url, Date.now() + 2000)).toBe(true);
  expect(requests).toBe(0);
  await server.stop(true);
  expect(await waitForListening(url, Date.now() + 500)).toBe(false);
});
