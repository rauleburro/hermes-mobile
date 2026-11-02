import { contrastRatio } from '@mobile/theme/contrast';

describe('contrastRatio', () => {
  it('is 21 for black on white, in either order', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1 for the same color', () => {
    expect(contrastRatio('#7C8BFF', '#7C8BFF')).toBeCloseTo(1, 5);
  });

  it('accepts the short #RGB form', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
  });

  it('matches a known mid-gray value', () => {
    // #767676 on white is the classic 4.54:1 pair.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });
});
