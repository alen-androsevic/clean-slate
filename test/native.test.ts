import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expoApps } from "../src/native";

function project(pkg: object, appJson?: object) {
  const dir = mkdtempSync(join(tmpdir(), "cs-native-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  if (appJson) writeFileSync(join(dir, "app.json"), JSON.stringify(appJson));
  return dir;
}

const appJson = { expo: { ios: { bundleIdentifier: "com.acme.app" }, android: { package: "com.acme.app.android" } } };

test("non-Expo projects have no native apps", async () => {
  expect(await expoApps(project({ dependencies: { vite: "*" } }))).toBeNull();
});

test("Expo Go projects are flagged, and Expo Go itself is never on the wipe list", async () => {
  expect(await expoApps(project({ dependencies: { expo: "*" } }, appJson))).toEqual({
    ios: ["com.acme.app"],
    android: ["com.acme.app.android"],
    expoGo: true,
  });
});

test("dev-client projects wipe their own app", async () => {
  expect(await expoApps(project({ dependencies: { expo: "*", "expo-dev-client": "*" } }, appJson))).toEqual({
    ios: ["com.acme.app"],
    android: ["com.acme.app.android"],
    expoGo: false,
  });
});
