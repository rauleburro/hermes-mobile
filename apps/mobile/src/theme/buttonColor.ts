import { Platform } from 'react-native';
import type { ColorRoles } from './tokens';

/**
 * The `color` prop for a native `Button`. React Native draws it as the text color on iOS and as the
 * background fill (with a white label) on Android, so each platform gets the role that reads there.
 */
export function buttonColor(
  colors: ColorRoles,
  kind: 'accent' | 'danger',
  os: string = Platform.OS,
): string {
  if (os === 'android') return kind === 'accent' ? colors.accentFill : colors.dangerFill;
  return kind === 'accent' ? colors.accent : colors.danger;
}
