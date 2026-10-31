# hermes-mobile

An **unofficial** mobile client for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Not affiliated with or endorsed by Nous Research.

You chat with your Hermes **Bots** from your phone: a roster of Bots, each with its canonical `Bot Chat`, streaming replies and tool approvals. Status: early MVP (single user, the BFF runs on the same Mac as Hermes, no voice yet).

```
apps/mobile      Expo app (SDK 58, expo-router): pairing, Bot chat with streaming, approvals, stop
services/bff     Node 24 + Hono: holds the Hermes API key, authenticates the phone, relays runs and SSE events
packages/api     Shared TypeScript types (app ⇄ BFF, Hermes run events)
```

## Principles

- **Stock Hermes.** Nothing is installed into or changed in Hermes: no patches, plugins, skills or hooks. The project only uses Hermes' public API, read-only reads of documented files (`profile.yaml`), and the documented `API_SERVER_*` settings. Anything missing is worked around in the BFF or the app.
- **Bot Mode.** The app is a roster of Bots (Hermes profiles managed by Bot Mode), and each Bot has its canonical `Bot Chat`. There are no loose sessions.
- **The Hermes key never reaches the phone.** Only the BFF holds `API_SERVER_KEY`; the phone gets its own device token.

## Setup

Requires Node 24 (`nvm use`), pnpm and a running Hermes Agent with Bot Mode enabled.

1. **Enable the Hermes API server.** Add this to `~/.hermes/.env`, then restart `hermes gateway`:
   ```
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<a long random value>
   ```
2. **Configure the BFF:**
   ```
   pnpm install
   cp services/bff/.env.example services/bff/.env   # set HERMES_API_KEY = API_SERVER_KEY
   pnpm pair                                         # generates DEVICE_TOKEN and prints the URL + QR
   pnpm bff                                          # http://0.0.0.0:8787
   ```
   Keep the BFF on your LAN or a private network (e.g. Tailscale). Never expose it to the public internet.
3. **Run the app:** `pnpm mobile`, then open it in Expo Go and enter the URL and token from `pnpm pair`.
   - The phone must be on the same network as the BFF.
   - Scanning the QR code with the phone camera only works in a development build, because it uses the `hermesmobile://` scheme.

## Building your own version

You are welcome to build and publish your own build. Change the app identifiers in `apps/mobile/app.json` (`ios.bundleIdentifier`, `android.package`, `scheme`) so your build doesn't collide with ours.

We build and publish our own release from this same public source, so anyone can audit what it runs.

## Contributing

Every change is test-first (TDD): write a failing test, make it pass with the minimum code, refactor with the tests green. Bug fixes included.

```
pnpm test        # tests (vitest)
pnpm typecheck
cd apps/mobile && npx expo lint
```

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for third-party notices.
