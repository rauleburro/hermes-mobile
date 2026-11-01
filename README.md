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
- **The Hermes key never reaches the phone.** Only the BFF holds the Hermes API key (`HERMES_API_KEY` in its `.env`, a copy of Hermes' `API_SERVER_KEY`, plus any `HERMES_PROFILE_KEY_*` for other Bots); the phone gets its own device token.

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
3. **Run the app:** build and install the development build once (`cd apps/mobile && npx expo run:android`), then `pnpm mobile` starts Metro for it. Open the pairing link from `pnpm pair` (scan the QR code, or send it with `adb` over USB) and tap **Pair**.
   - The phone must reach the BFF: over USB with `adb reverse` and `pnpm pair --url http://localhost:8787`, or on the same LAN or Tailscale network.
   - Step-by-step guide, including troubleshooting: [Run on an Android phone](apps/mobile/README.md#run-on-an-android-phone).

## Building your own version

You are welcome to build and publish your own build. The app identifiers come from environment variables, so a fork changes them without editing any tracked file:

| Variable | What | Default |
|---|---|---|
| `APP_NAME` | Display name | `Hermes` |
| `APP_SLUG` | Expo slug (lowercase letters, digits, `-`) | `hermes-mobile` |
| `APP_SCHEME` | URL scheme of the pairing link | `hermesmobile` |
| `APP_BUNDLE_ID` | iOS bundle identifier | `dev.rauleburro.hermesmobile` |
| `APP_ANDROID_PACKAGE` | Android application id | `dev.rauleburro.hermesmobile` |

**Local builds:** put them in `apps/mobile/.env.local` (never committed: the repo ignores it). The Expo CLI loads that file for every command that evaluates the config (`npx expo run:android`, `pnpm mobile`, `npx expo config`), so Metro and the native build always agree:

```
# apps/mobile/.env.local
APP_NAME=My Bots
APP_SLUG=my-bots
APP_SCHEME=mybots
APP_BUNDLE_ID=com.example.mybots
APP_ANDROID_PACKAGE=com.example.mybots
```

Check the result with `cd apps/mobile && npx expo config --type public`. Exporting the same variables in the shell also works, as long as every command that evaluates the config sees them.

**EAS builds:** cloud workers don't see your local shell or `.env.local`. Set the variables in the `env` block of the build profile in your `eas.json`, or as EAS environment variables.

Invalid values (a scheme that is not a lowercase URI scheme, an id that is not reverse-DNS) fail loudly at config time. Blank values count as unset. If you change `APP_SCHEME`, put the same value in `services/bff/.env` (or export it when running `pnpm pair`) so the pairing links match. Use your own identifiers consistently across builds: Android treats a different package as a different app, and changing identifiers needs a native rebuild.

We build and publish our own release from this same public source, so anyone can audit what it runs.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules and [SECURITY.md](SECURITY.md) to report a vulnerability. In short, every change is test-first (TDD): write a failing test, make it pass with the minimum code, refactor with the tests green. Bug fixes included.

```
pnpm test        # all test suites
pnpm typecheck
pnpm lint
pnpm hygiene     # no personal paths, tracked .env files, keys or tokens
```

Before opening a PR, commit your work and run `pnpm validate`: it runs all of the above and, only if everything passes, stamps the HEAD commit with a `Validated-tree: <hash>` trailer. The pre-push hook (installed by `pnpm install` through [lefthook](https://lefthook.dev); skip once with `LEFTHOOK=0`) refuses to push a commit whose stamp is missing or stale, so any change after validating means validating again. Commits that are already on a remote (for example a tag on `main`, or a new branch cut from it) are not checked again. If the hook can't be installed (for example when `core.hooksPath` is set), `pnpm install` only prints a warning; run `npx lefthook install` by hand. The pre-commit hook runs the hygiene check (and lint when app code changed).

The hygiene check scans tracked files only. A line that legitimately mentions something it would flag (for example documentation about what not to commit) can carry the marker `hygiene-allow` to be skipped.

### CI

Validation has two layers. The first is local: `pnpm validate` and the receipt it stamps. The second is the GitHub Actions workflow in `.github/workflows/ci.yml`:

- A pull request first runs a receipt job that checks, in seconds and without installing anything, that its head commit carries a `Validated-tree` trailer matching the commit's tree. If the receipt is missing or stale, that job fails and the full CI never starts. Draft PRs are skipped until they are marked ready for review.
- With a valid receipt, the full CI runs the same steps as `pnpm validate` (install with the frozen lockfile, tests, typecheck, lint, hygiene).
- The full CI always runs on `main`, with no receipt needed, since squash-merged commits don't carry one.
- For pull requests from first-time outside contributors, GitHub holds the workflow run until a maintainer approves it ([details](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/approving-workflow-runs-from-public-forks)).

A receipt is a convenience, not proof: anyone can forge the trailer by hand. That is why the full CI is the backstop for every PR that passes the receipt check, and why it runs again on `main`.

## Testing

Tests live under `tests/<area>`, not next to the code they test:

- `tests/mobile` (`@hermes-mobile/mobile-tests`): the app's tests, with [jest-expo](https://docs.expo.dev/develop/unit-testing/) and React Native Testing Library. They import app code through the `@mobile/*` alias, which maps to `apps/mobile/src/*` (for example `import { createSseParser } from '@mobile/lib/sse'`). Component tests mock `expo-router`, `@mobile/lib/bff` and `@mobile/lib/config` as needed; see `tests/mobile/src/app/pair.test.tsx` for a screen test.
- `services/bff/test`: the BFF's tests, with vitest.
- `tests/api` (`@hermes-mobile/api-tests`): contract tests for `packages/api`, with vitest. Type-level checks (`expectTypeOf`, `@ts-expect-error`) are enforced by `pnpm typecheck`.

Why mobile tests are not inside `apps/mobile`: expo-router turns every file under `apps/mobile/src/app` into a route, so a test file there would ship as a screen. A separate package avoids that and keeps the app free of test tooling.

Run everything with `pnpm test` from the repo root, or one suite with `pnpm --filter @hermes-mobile/mobile-tests test` (`@hermes-mobile/bff` for the BFF). To add a suite for another area, create `tests/<name>` as a workspace package with its own `test` and `typecheck` scripts.

## Branding

Hermes Mobile is an unofficial client for Hermes Agent, not affiliated with Nous Research.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for third-party notices.
