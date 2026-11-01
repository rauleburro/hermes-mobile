# @hermes-mobile/mobile

The Expo app (SDK 58, expo-router). See the [root README](../../README.md) for setup.

```
pnpm mobile              # from the repo root: start Metro for the development build
npx expo lint            # lint
npx tsc --noEmit         # typecheck
npx expo run:android     # build and install the development build (needed for the pairing QR link, `hermesmobile://` by default)
```

Routes live in `src/app/`. Install native packages with `npx expo install`. Agent rules for this package are in [AGENTS.md](AGENTS.md).

## Run on an Android phone

The app runs as a **development build**: a debug APK with [`expo-dev-client`](https://docs.expo.dev/versions/v58.0.0/sdk/dev-client/) that loads its JavaScript from Metro on your computer. Expo Go is not supported, because the pairing QR code uses the app's own URL scheme (`hermesmobile://` unless a fork sets `APP_SCHEME`).

### Prerequisites

- Node 24, pnpm, and `pnpm install` done at the repo root.
- JDK 17 (the JDK bundled with Android Studio works) with `JAVA_HOME` pointing at it. Newer JDKs can fail with `Unsupported class file major version`.
- Android SDK with platform-tools, `ANDROID_HOME` set and `adb` on your `PATH`.
- A phone with developer options and USB debugging enabled, connected over USB. `adb devices` must list it as `device` (not `unauthorized`).

### Build and install

```
cd apps/mobile
npx expo run:android
```

The first run generates `android/` (gitignored, never edited by hand), builds the debug APK (several minutes the first time), installs it on the phone and starts Metro on port 8081. Add `--port <port>` to use another Metro port. Rebuild only when native dependencies, `app.json`, `app.config.ts` or the `APP_*` identifiers change; JavaScript changes just need Metro.

On the first launch Android may ask to let Hermes find nearby devices (the development build uses it to discover Metro on the LAN); it is not needed with `adb reverse`. The Expo developer menu also opens once on the first load; close it.

### Start Metro and open the app

Later sessions don't need a rebuild:

```
pnpm mobile                            # Metro on 8081 (or: npx expo start --dev-client --port <port>)
adb reverse tcp:8081 tcp:8081          # the phone reaches Metro on its own localhost
```

Open **Hermes** on the phone. The development build shows its launcher: type `http://localhost:8081` in the URL field and tap **Connect** (next time it is listed under *Recently opened*). Or load the server directly from the computer, which also works when the app is closed:

```
adb shell am start -a android.intent.action.VIEW \
  -d 'exp+hermes-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
```

(In a fork, the development-client scheme follows `APP_SLUG`: `exp+<slug>://`.)

### Pair with the BFF

`pnpm pair` (in the repo root) prints the BFF URL, the device token, the pairing link `hermesmobile://pair?url=…&token=…` (your `APP_SCHEME` in a fork) and the same link as a QR code. **Scan the QR code with the phone camera**: it opens the pair screen with the URL and token filled in; check them and tap **Pair**. The app checks `GET /health` on the BFF, stores the pairing in secure storage and goes to the home screen. If the app was already paired, the screen says which BFF the new pairing replaces. A link without a token never reuses the stored token for a different BFF: type the token, or use a link that carries it.

How the phone reaches the BFF:

- **USB with `adb reverse` (development).** Keep `BFF_HOST=127.0.0.1` in `services/bff/.env`, then:
  ```
  adb reverse tcp:8787 tcp:8787
  pnpm pair --url http://localhost:8787
  ```
  and scan the QR code. The `localhost` URL works on the phone because `adb reverse` forwards the port.
- **LAN or Tailscale.** Set `BFF_HOST=0.0.0.0` (or the Tailscale address) so the BFF listens beyond localhost, then run `pnpm pair` (it uses the first LAN address) or `pnpm pair --url http://<bff-host>:8787` with your Tailscale name or IP, and scan the QR code. Keep the BFF on a private network; never expose it to the internet.

**Without a camera (adb).** You can send the link from the computer. Two details matter:

- Quote the whole `am start` command, because `adb shell` runs it through the phone's shell, and an unquoted `&` cuts the link before `token=`.
- Don't type the token itself: a literal token stays in your shell history. Read it from `.env` instead, running this from the repo root (where `services/bff/.env` lives, not `apps/mobile`):

```
adb shell "am start -a android.intent.action.VIEW -d 'hermesmobile://pair?url=http%3A%2F%2Flocalhost%3A8787&token=$(grep '^DEVICE_TOKEN=' services/bff/.env | cut -d= -f2-)'"
```

The token is base64url, so it needs no further escaping. It still passes through the `adb` command line and the intent, so use this only on your own computer and phone.

Without a link, open the pair screen from **Pair** on the home screen and type the URL and token.

### Troubleshooting

- **`Unsupported class file major version`** during the build: Gradle is running on a JDK that is too new. Point `JAVA_HOME` at JDK 17.
- **`SDK location not found`**: set `ANDROID_HOME`, or create `android/local.properties` with `sdk.dir=<path to the SDK>`.
- **The app shows "Unable to load script" or the server list is empty**: Metro is not running or the phone can't reach it. Run `adb reverse tcp:<metro-port> tcp:<metro-port>` again (it resets when the cable is unplugged or `adb` restarts).
- **"Could not reach the BFF"** on Pair: from the phone's point of view the URL must work. With USB, check `adb reverse --list` includes the BFF port; on the LAN, check `BFF_HOST` is not `127.0.0.1` and the firewall allows the port. `curl http://localhost:<bff-port>/health` on the computer should return `{"ok":true,...}`.
- **Requests to a LAN BFF time out after 15 s, and Metro hangs for about 2 minutes, then fails (Android 17)**: Android 17 blocks the local network (private addresses such as `192.168.x.x`, `10.x.x.x`, and `.local` names) for apps without the **Nearby devices** permission (`ACCESS_LOCAL_NETWORK`). Development builds ask for it at launch, and the app asks again before pairing to a local address. If it was denied, allow it in *Settings > Apps > (the app) > Permissions > Nearby devices*, or tap *Open settings* under the error. USB with `adb reverse` (`localhost`) is not affected.
- **The pairing link opens the launcher instead of the pair screen**: the app was closed, so the development build doesn't know which Metro to load. Tap your server under *Recently opened* (the link is delivered once the bundle loads), or load Metro first (above) and open the link again.
- **Start over**: `adb shell pm clear dev.rauleburro.hermesmobile` (your `APP_ANDROID_PACKAGE` in a fork) wipes the pairing and the development build's recent servers.
