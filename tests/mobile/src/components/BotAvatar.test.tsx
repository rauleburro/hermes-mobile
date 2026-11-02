import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { BotAvatar } from '@mobile/components/BotAvatar';
import { botHue } from '@mobile/theme';

const styleOf = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) ?? {};

describe('BotAvatar', () => {
  it.each(['default', 'research-bot', 'writer', 'ops'])('is filled with the hue of Bot %s, with white initials', async (botId) => {
    await render(<BotAvatar botId={botId} name="Ada Lovelace" />);

    const circle = screen.getByText('AL').parent!;
    expect(styleOf(circle).backgroundColor).toBe(botHue(botId).fill);
    expect(styleOf(screen.getByText('AL')).color).toBe('#FFFFFF');
  });

  it('gives the primary Bot indigo', async () => {
    await render(<BotAvatar botId="default" name="Hermes" />);

    expect(styleOf(screen.getByText('HE').parent!).backgroundColor).toBe(botHue('default').fill);
    expect(botHue('default').name).toBe('indigo');
  });

  it('gives different Bots different hues', async () => {
    const a = 'default';
    const b = ['research-bot', 'writer', 'ops', 'scout', 'coder'].find((id) => botHue(id).fill !== botHue(a).fill)!;
    await render(
      <>
        <BotAvatar botId={a} name="Alpha Zed" />
        <BotAvatar botId={b} name="Beta Yak" />
      </>,
    );

    expect(styleOf(screen.getByText('AZ').parent!).backgroundColor).toBe(botHue(a).fill);
    expect(styleOf(screen.getByText('BY').parent!).backgroundColor).toBe(botHue(b).fill);
    expect(botHue(a).fill).not.toBe(botHue(b).fill);
  });

  it('keeps the size and round shape', async () => {
    await render(<BotAvatar botId="default" name="Hermes" size={60} />);

    expect(styleOf(screen.getByText('HE').parent!)).toMatchObject({ width: 60, height: 60, borderRadius: 30 });
  });
});
