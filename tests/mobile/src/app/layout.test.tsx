import { render } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import RootLayout from '@mobile/app/_layout';
import { navigationTheme } from '@mobile/theme';

const mockThemeValues: unknown[] = [];
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    ThemeProvider: ({ value, children }: { value: unknown; children: unknown }) => {
      mockThemeValues.push(value);
      return children;
    },
    Stack: Object.assign(() => null, { Screen: () => null }),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
  mockThemeValues.length = 0;
});

describe('RootLayout', () => {
  it.each(['light', 'dark'] as const)('provides the token-based navigation theme in %s', async (scheme) => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
    await render(<RootLayout />);
    expect(mockThemeValues.at(-1)).toEqual(navigationTheme(scheme));
  });
});
