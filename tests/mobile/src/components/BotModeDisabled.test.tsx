import { render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';
import { BotModeDisabled } from '@mobile/components/BotModeDisabled';
import { colors } from '@mobile/theme';

afterEach(() => jest.restoreAllMocks());

const color = (text: string | RegExp) => StyleSheet.flatten(screen.getByText(text).props.style).color;

describe('BotModeDisabled theme', () => {
  it.each(['light', 'dark'] as const)('colors the title and steps primary, the explanations secondary and the error danger (%s)', async (scheme) => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
    await render(<BotModeDisabled onRetry={() => {}} error="Could not reach Hermes" />);

    expect(color('Bot Mode is not enabled')).toBe(colors[scheme].text);
    expect(color(/^1\. Open Hermes Desktop/)).toBe(colors[scheme].text);
    expect(color(/^This app talks to your Hermes Bots/)).toBe(colors[scheme].textSecondary);
    expect(color('Then come back and check again.')).toBe(colors[scheme].textSecondary);
    expect(color('Could not reach Hermes')).toBe(colors[scheme].danger);
  });
});
