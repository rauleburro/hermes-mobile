# hermes-mobile

Unofficial mobile client for Hermes Agent. pnpm monorepo (`node-linker=hoisted` for React Native). Node 24. Public, Apache-2.0.

- `apps/mobile`: Expo SDK 58 + expo-router, routes in `src/app/`. Install native packages with `npx expo install`. Read the SDK 58 docs, not `latest`. Its `AGENTS.md` has the Expo rules.
- `tests/mobile`: mobile tests (`@hermes-mobile/mobile-tests`, jest-expo + React Native Testing Library). They live outside `apps/mobile` on purpose (expo-router would treat files under `src/app` as routes) and import app code via the `@mobile/*` alias (`apps/mobile/src/*`). Put new test suites for other areas under `tests/<name>`.
- `services/bff`: Hono on Node. `createApp()` in `src/app.ts` is pure and testable, with fetch injected. It is the only component that knows `HERMES_API_KEY`. The phone authenticates with `DEVICE_TOKEN`.
- `packages/api`: shared types. Hermes shapes mirror `gateway/platforms/api_server*.py` in hermes-agent (written against v0.22.0, contract checked against v0.22.5).
- Hermes API: runs with `Idempotency-Key`, SSE `/v1/runs/{id}/events` with `Last-Event-ID`, approvals need `{request_id, execution_generation, choice}` with choices `once|session|always|deny`. See hermes-agent's `website/docs/user-guide/features/api-server.md`.
- Before finishing: `pnpm test`, `pnpm typecheck`, `cd apps/mobile && npx expo lint`.

## Premises
- **Hermes stays clean:** everything is solved on our side (BFF, app). Never modify Hermes: no code changes, no plugins/skills/hooks installed into it, no edits to its state. Only its public API, read-only reads of documented files (`profile.yaml`), and the documented `API_SERVER_*` config. Missing features → workaround in the BFF/app, or an upstream feature request.
- **Bot Mode is required:** the app is a roster of Bots (profiles). Each Bot has its canonical `Bot Chat` (`GET /api/sessions?title=Bot%20Chat&include_hidden=true`). No loose sessions.

## TDD (mandatory)
Every code change is test-first: write the test, run it and see it fail for the right reason, write the minimum code to pass, refactor with the tests green. Bug fixes included. If something truly can't be tested (pure config, a spike), say so explicitly.

## Public repo hygiene
This repo is public. Never commit secrets, `.env` files, personal paths, IPs, device serials, or material from other apps (code, assets, keys, decompiled output). Placeholders only.
