// Mobile test harness. Tests live here, outside apps/mobile, so expo-router never
// mistakes them for routes. They import app code through aliases:
//   @mobile/*  ->  apps/mobile/src/*   (use this in tests)
//   @/*        ->  apps/mobile/src/*   (the app's own alias, so app files that use it resolve)
//   @/assets/* ->  apps/mobile/assets/* (the app's own alias; assets live outside src)
// Keep these in sync with `paths` in tsconfig.json. The jest-expo preset applies
// babel-preset-expo to app sources and already handles node_modules transforms.
const path = require('node:path');
const expoPreset = require('jest-expo/jest-preset');

// `marked` ships ESM only, so it must go through babel like the React Native packages.
const [nodeModulesPattern, ...otherIgnorePatterns] = expoPreset.transformIgnorePatterns;
const transformIgnorePatterns = [nodeModulesPattern.replace('(?!(', '(?!(marked|'), ...otherIgnorePatterns];

const appRoot = path.join(__dirname, '../../apps/mobile');
const appSrc = path.join(appRoot, 'src');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  rootDir: __dirname,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.{ts,tsx}'],
  transformIgnorePatterns,
  // CI runners are small: a suite's first test pays the cold babel transform of React
  // Native while other suites run in parallel workers (pair.test.tsx took ~9 s there,
  // with its first test hitting the 5 s default).
  testTimeout: 15_000,
  moduleNameMapper: {
    '^@mobile/(.*)$': `${appSrc}/$1`,
    // More specific first: `@/assets/*` must win over the `@/*` catch-all.
    '^@/assets/(.*)$': `${appRoot}/assets/$1`,
    '^@/(.*)$': `${appSrc}/$1`,
  },
};
