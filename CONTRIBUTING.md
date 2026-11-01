# Contributing

Thanks for helping. Hermes Mobile is an unofficial client for Hermes Agent, not affiliated with Nous Research. Please read the [README](README.md) first for what it does and how it is laid out.

## Premises

Changes that break one of these will not be merged:

- **Stock Hermes stays untouched.** Everything is solved in the BFF (`services/bff`) or the app (`apps/mobile`). No patches, plugins, skills or hooks installed into Hermes, no edits to its state. The project only uses Hermes' public API, read-only reads of documented files (`profile.yaml`) and the documented `API_SERVER_*` settings. If a feature needs Hermes to change, open an issue as an upstream feature request instead.
- **Bot Mode is required.** The app is a roster of Bots (Hermes profiles), and each Bot has its canonical `Bot Chat`. There are no loose sessions.
- **The Hermes API key never reaches the phone.** Only the BFF holds `API_SERVER_KEY`; the phone has its own device token.

## Test-first (TDD)

Every code change starts with a failing test: write the test, run it and see it fail for the right reason, write the minimum code to pass it, then refactor with the tests green. Bug fixes included: reproduce the bug in a test first. If something truly cannot be tested (pure configuration, a spike), say so in the PR instead of skipping silently.

Documentation-only changes need no test.

Tests live under `tests/<area>` (mobile, with jest-expo and React Native Testing Library) and `services/bff/test` (vitest). See [Testing](README.md#testing) for how to add one.

## Run it against your own Hermes

1. Enable the Hermes API server and restart the gateway, then configure the BFF and pair the app, as described in [Setup](README.md#setup). Use a Hermes you can afford to experiment with: Bot Chats are real chats, so messages you send stay in them.
2. Keep the BFF on your LAN, a private network such as Tailscale, or `adb reverse` over USB. Never expose it to the public internet (see [SECURITY.md](SECURITY.md)).
3. For the Android development build and troubleshooting, follow [Run on an Android phone](apps/mobile/README.md#run-on-an-android-phone).

## Before you open a PR

```
pnpm install
pnpm validate    # test, typecheck, lint, hygiene; then stamps HEAD with a Validated-tree receipt
```

Commit first (`pnpm validate` needs a clean tree), run it, then push. Any commit after validating needs a new run, because the pre-push hook rejects a missing or stale receipt. The pull request workflow checks the receipt first and then runs the same steps as `pnpm validate` in full. Details are in [CI](README.md#ci).

Keep pull requests focused on one change, and describe in the PR what you tested and how.

## Public repo hygiene

This repo is public. Never commit secrets, `.env` files, personal paths, IP addresses, device serial numbers or API keys. Use placeholders such as `<device-token>` and `http://localhost:8787`. `pnpm hygiene` checks tracked files for the generic cases, but PR text and screenshots are your responsibility. Contribute only code and assets you wrote or that are licensed compatibly with Apache-2.0; do not copy code, assets or keys from other apps.

## Building your own version

Forks and your own builds are welcome. The app name, slug, URL scheme, iOS bundle id and Android package come from environment variables (`APP_NAME`, `APP_SLUG`, `APP_SCHEME`, `APP_BUNDLE_ID`, `APP_ANDROID_PACKAGE`), so you don't edit tracked files. See [Building your own version](README.md#building-your-own-version) for the table and an example. Please keep the "unofficial client for Hermes Agent, not affiliated with Nous Research" line wherever your build is presented.

## License

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), the same as the project (see [NOTICE](NOTICE) for third-party notices).

## Security

Please do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
