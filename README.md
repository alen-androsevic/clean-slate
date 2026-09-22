# clean-slate

Run your dev server so every run starts from empty state, in the browser and on simulators and devices. When you stop the server, everything the app stored is deleted.

This stops old dev state from leaking into what you're testing now: a stale feature flag in localStorage or AsyncStorage, a leftover service worker, a cookie from last week's auth experiment.

Supports macOS and Linux.

## How it works

**Web.** clean-slate creates a session directory in the OS temp dir. It opens Chrome, Chromium, Brave, Edge or Firefox with its profile inside that directory, so localStorage, sessionStorage, IndexedDB, cookies, service workers and cache all live there. The directory is deleted on exit. Sessions left by crashed runs are deleted the next time any project starts clean-slate.

**Native.** In Expo projects, clean-slate wipes the app's data once at startup and again on exit.

| | What gets wiped |
| --- | --- |
| Android (every device and emulator in `adb devices`) | `pm clear`: app data, cache and runtime permissions |
| iOS simulator (every booted one) | the app's data folder (Documents, Library, tmp; this includes AsyncStorage and SQLite), its `NSUserDefaults` and its permissions |

The apps come from the Expo config (`ios.bundleIdentifier`, `android.package`, including values set in `app.config.js`/`.ts`). For other React Native projects, pass `--app-id`.

Only your own app is touched:

- **Expo Go is never wiped.** Its storage is shared with every project you open in it, and it holds your Expo login. If you need a clean native slate, use a development build (`expo-dev-client`).
- **The iOS simulator keychain is kept** unless you pass `--reset-keychain`. SecureStore keeps its data there, so SecureStore data survives on iOS by default. The simulator can only reset its keychain as a whole: every app's items and any root certificates you've trusted, such as mkcert or a Proxyman/Charles certificate. On Android, SecureStore data is in the app's own storage and is always wiped.

**The dev server** runs in a pseudo-terminal. Interactive CLIs keep their full UI: Expo's QR code and key shortcuts, prompts, colours. clean-slate still reads the output to find the URL. Loopback and private LAN addresses (`192.168.*`, `10.*`, `172.16–31.*`) count; `exp://` links are ignored. `BROWSER=none` is set so the dev server doesn't open your normal browser.

## Install

Requirements:

- macOS or Linux
- [Bun](https://bun.sh) 1.3 or newer. If clean-slate reports that pseudo-terminal support is missing, run `bun upgrade`.
- Chrome, Chromium, Brave, Edge or Firefox
- For native wiping (optional): Xcode for iOS simulators; `adb` for Android, found on `PATH`, in `$ANDROID_HOME`/`$ANDROID_SDK_ROOT`, or in the default SDK location

**Per project (recommended).** Everyone on the team gets it with `bun install`:

```sh
bun add -d github:alen-androsevic/clean-slate
```

Then use it in your `package.json` scripts (see [Use](#use)).

**Globally**, to use `clean-slate` in any project without adding a dependency:

```sh
bun add -g github:alen-androsevic/clean-slate
```

This puts `clean-slate` in `~/.bun/bin`, which the Bun installer adds to your `PATH`. Run the same command again to update, and `bun remove -g clean-slate` to uninstall.

To pin a version, add a tag or commit: `github:alen-androsevic/clean-slate#v0.1.0`.

**From a clone**, to work on clean-slate itself:

```sh
git clone https://github.com/alen-androsevic/clean-slate.git
cd clean-slate
bun install
bun link        # `clean-slate` now runs your checkout; `bun unlink` undoes it
```

Check the install with `clean-slate --help`.

## Use

Wrap your dev script in `package.json`:

```json
{
  "scripts": {
    "start": "clean-slate expo start",
    "start:dirty": "expo start"
  }
}
```

`bun run start` then starts clean every time. To try it without editing `package.json`, name an existing script: `bunx clean-slate start` runs `bun run start` inside a session.

| Option | |
| --- | --- |
| `--url <url>` | Open this URL instead of detecting it from the server output |
| `--browser <name\|path>` | `chrome`, `chromium`, `brave`, `edge`, `firefox`, or a path to an executable. Default: the first one installed. Env: `CLEAN_SLATE_BROWSER` |
| `--app-id <id>` | Native bundle id or package to wipe (repeatable) |
| `--no-native` | Don't touch simulators or devices |
| `--reset-keychain` | Also reset the iOS simulator keychain, which clears SecureStore data. This affects the whole simulator. |
| `--timeout <sec>` | How long to wait for the server (default 60) |
| `--headless` | Run the browser headless |
| `--keep` | Keep the browser session and native app data on exit, for inspecting what the app stored |

Set `CLEAN_SLATE=0` to run the command without any of this, e.g. in CI. The dev server receives `CLEAN_SLATE_SESSION=<id>` in its environment.

Ctrl+C goes to the dev server as usual. If the server doesn't stop, a second Ctrl+C makes clean-slate stop everything.

## Notes

- **Native wipes cover devices that are connected when clean-slate starts and when it exits.** A simulator you boot mid-session is wiped on exit, so the next run starts clean.
- **Physical iOS devices aren't supported;** Apple provides no tool to clear an app's data on one. Android physical devices work over `adb`.
- **The fresh browser profile has no extensions installed.** To use React DevTools and similar, install them in that window; they are removed with the session.
- **Closing the browser window doesn't stop the server.** Restart the command to get a new session.

## Development

```sh
bun test   # unit tests + an end-to-end test that runs a real headless browser twice
```

## License

[0BSD](LICENSE): use, change and share it however you like.
