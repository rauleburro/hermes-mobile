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

Why mobile tests are not inside `apps/mobile`: expo-router turns every file under `apps/mobile/src/app` into a route, so a test file there would ship as a screen. A separate package avoids that and keeps the app free of test tooling.

Run everything with `pnpm test` from the repo root, or one suite with `pnpm --filter @hermes-mobile/mobile-tests test` (`@hermes-mobile/bff` for the BFF). To add a suite for another area, create `tests/<name>` as a workspace package with its own `test` and `typecheck` scripts.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for third-party notices.
