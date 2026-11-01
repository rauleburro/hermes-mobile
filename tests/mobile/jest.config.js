// Mobile test harness. Tests live here, outside apps/mobile, so expo-router never
// mistakes them for routes. They import app code through aliases:
//   @mobile/*  ->  apps/mobile/src/*   (use this in tests)
//   @/*        ->  apps/mobile/src/*   (the app's own alias, so app files that use it resolve)
//   @/assets/* ->  apps/mobile/assets/* (the app's own alias; assets live outside src)
// Keep these in sync with `paths` in tsconfig.json. The jest-expo preset applies
// babel-preset-expo to app sources and already handles node_modules transforms.
const path = require('node:path');

const appRoot = path.join(__dirname, '../../apps/mobile');
const appSrc = path.join(appRoot, 'src');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  rootDir: __dirname,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.{ts,tsx}'],
  moduleNameMapper: {
    '^@mobile/(.*)$': `${appSrc}/$1`,
    // More specific first: `@/assets/*` must win over the `@/*` catch-all.
    '^@/assets/(.*)$': `${appRoot}/assets/$1`,
    '^@/(.*)$': `${appSrc}/$1`,
  },
};
