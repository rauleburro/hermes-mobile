// react-native-mmkv swaps in its own in-memory mock under Jest (createMMKV checks JEST_WORKER_ID),
// but it still imports react-native-nitro-modules at load time, which looks up a native
// TurboModule. Stub that import; the MMKV mock never calls into it.
jest.mock('react-native-nitro-modules', () => ({ NitroModules: { createHybridObject: jest.fn() } }));
