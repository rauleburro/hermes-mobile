/**
 * Placeholder text color for inputs. Android's default hint color doesn't follow the app theme,
 * so in light mode it can vanish. Dimmer than the text, still readable (WCAG AA) on the background.
 */
export const placeholderColor = (theme: { dark: boolean }) => (theme.dark ? '#9a9aa0' : '#6b6b70');
