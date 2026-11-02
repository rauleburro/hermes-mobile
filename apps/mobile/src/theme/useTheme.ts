import { useColorScheme } from 'react-native';
import { botHue } from './botHue';
import { colors, radius, sizes, spacing, typography } from './tokens';

/** Design tokens for the system color scheme (anything but `dark` is light). */
export function useTheme() {
  const scheme: 'light' | 'dark' = useColorScheme() === 'dark' ? 'dark' : 'light';
  const roles = colors[scheme];
  return {
    scheme,
    dark: scheme === 'dark',
    colors: roles,
    /** Input placeholder color: the secondary text role, readable (AA) on the background. */
    placeholder: roles.textSecondary,
    typography,
    spacing,
    radius,
    sizes,
    botHue,
  };
}
