# @hermes-mobile/mobile

The Expo app (SDK 58, expo-router). See the [root README](../../README.md) for setup.

```
pnpm mobile              # from the repo root: start the dev server
npx expo lint            # lint
npx tsc --noEmit         # typecheck
npx expo run:android     # development build (needed for the hermesmobile:// QR deep link)
```

Routes live in `src/app/`. Install native packages with `npx expo install`. Agent rules for this package are in [AGENTS.md](AGENTS.md).
