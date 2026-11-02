import { render, screen } from '@testing-library/react-native';
import { Lexer } from 'marked';
import * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';
import { MessageBubble } from '@mobile/components/MessageBubble';
import { botHue, colors } from '@mobile/theme';

const styleOf = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) ?? {};

afterEach(() => jest.restoreAllMocks());

describe('MessageBubble', () => {
  describe.each(['light', 'dark'] as const)('in the %s scheme', (scheme) => {
    beforeEach(() => {
      jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
    });

    it.each(['default', 'research-bot', 'writer'])("fills the user's bubble with the hue of Bot %s, with white text", async (botId) => {
      await render(<MessageBubble botId={botId} role="user" text="hi" />);

      expect(styleOf(screen.getByLabelText('You: hi')).backgroundColor).toBe(botHue(botId).fill);
      expect(styleOf(screen.getByText('hi')).color).toBe('#FFFFFF');
    });

    it('puts the assistant bubble on the surface color, with the text color', async () => {
      await render(<MessageBubble botId="research-bot" role="assistant" text="hello" streaming />);

      expect(styleOf(screen.getByLabelText('Bot: hello')).backgroundColor).toBe(colors[scheme].surface);
      expect(styleOf(screen.getByText('hello')).color).toBe(colors[scheme].text);
    });

    it('keeps a Markdown reply on the surface color too', async () => {
      await render(<MessageBubble botId="research-bot" role="assistant" text="hello **there**" />);

      expect(styleOf(screen.getByLabelText('Bot: hello there')).backgroundColor).toBe(colors[scheme].surface);
    });
  });

  it('is one accessible element that a screen reader reads as the Bot speaking, with the text', async () => {
    await render(<MessageBubble botId="default" role="assistant" text="hello" />);

    const bubble = screen.getByLabelText('Bot: hello');
    expect(bubble).toHaveProp('accessible', true);
    expect(screen.getByText('hello')).toBeOnTheScreen();
  });

  it('is read as your own message for user lines', async () => {
    await render(<MessageBubble botId="default" role="user" text="hi" />);

    expect(screen.getByLabelText('You: hi')).toHaveProp('accessible', true);
    expect(screen.queryByLabelText('Bot: hi')).toBeNull();
  });

  it('renders a final assistant reply as Markdown', async () => {
    await render(<MessageBubble botId="default" role="assistant" text="Sure, **bold** reply" />);

    expect(screen.getByText('bold')).toBeOnTheScreen();
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
  });

  it('shows what the user sent literally, without interpreting Markdown', async () => {
    await render(<MessageBubble botId="default" role="user" text="Please use **stars** and `ticks`" />);

    expect(screen.getByText('Please use **stars** and `ticks`')).toBeOnTheScreen();
  });

  it('keeps a reply that is still streaming as plain text', async () => {
    await render(<MessageBubble botId="default" role="assistant" text="Partial **bold**" streaming />);

    expect(screen.getByText('Partial **bold**')).toBeOnTheScreen();
  });

  it('lets a screen reader reach each link: a bubble with links is not one grouped element', async () => {
    await render(<MessageBubble botId="default" role="assistant" text="See [the docs](https://example.com/docs) and [faq](https://example.com/faq)." />);

    expect(screen.getByRole('link', { name: 'the docs' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'faq' })).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Bot: /)).toBeNull();
  });

  it('stays one grouped element when its only link is not openable (shown as plain text)', async () => {
    await render(<MessageBubble botId="default" role="assistant" text="[x](javascript:alert(1))" />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByLabelText('Bot: x')).toHaveProp('accessible', true);
  });

  it('reads a grouped reply as plain text, without Markdown syntax', async () => {
    await render(<MessageBubble botId="default" role="assistant" text={'# Plan\n\n- **first** step\n- run `make`'} />);

    expect(screen.getByLabelText('Bot: Plan\nfirst step\nrun make')).toHaveProp('accessible', true);
  });

  it('keeps the label of user lines and streaming replies literal', async () => {
    await render(<MessageBubble botId="default" role="user" text="**hi**" />);
    expect(screen.getByLabelText('You: **hi**')).toBeOnTheScreen();

    await render(<MessageBubble botId="default" role="assistant" text="Partial **bold**" streaming />);
    expect(screen.getByLabelText('Bot: Partial **bold**')).toBeOnTheScreen();
  });

  it('lexes a reply once for its links, label and rendering', async () => {
    const lex = jest.spyOn(Lexer.prototype, 'lex');
    try {
      await render(<MessageBubble botId="default" role="assistant" text="Some **bold** text" />);
      expect(lex).toHaveBeenCalledTimes(1);
    } finally {
      lex.mockRestore();
    }
  });
});
