// The aliases mirror apps/mobile/tsconfig.json; these checks catch them drifting apart.
describe('path aliases', () => {
  it('resolves @mobile/* and @/* to apps/mobile/src', () => {
    expect(require('@mobile/lib/sse')).toBe(require('@/lib/sse'));
  });

  it('resolves @/assets/* to apps/mobile/assets, outside src', () => {
    expect(() => require('@/assets/images/icon.png')).not.toThrow();
  });
});
