import { render, screen } from '@testing-library/react-native';
import { Lexer } from 'marked';
import { MessageBubble } from '@mobile/components/MessageBubble';

jest.mock('expo-router', () => ({
  useTheme: () => ({ colors: { text: 'black', border: 'gray', card: 'white', primary: 'blue' } }),
}));

describe('MessageBubble', () => {
  it('is one accessible element that a screen reader reads as the Bot speaking, with the text', async () => {
    await render(<MessageBubble role="assistant" text="hello" />);

    const bubble = screen.getByLabelText('Bot: hello');
    expect(bubble).toHaveProp('accessible', true);
    expect(screen.getByText('hello')).toBeOnTheScreen();
  });

  it('is read as your own message for user lines', async () => {
    await render(<MessageBubble role="user" text="hi" />);

    expect(screen.getByLabelText('You: hi')).toHaveProp('accessible', true);
    expect(screen.queryByLabelText('Bot: hi')).toBeNull();
  });

  it('renders a final assistant reply as Markdown', async () => {
    await render(<MessageBubble role="assistant" text="Sure, **bold** reply" />);

    expect(screen.getByText('bold')).toBeOnTheScreen();
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
  });

  it('shows what the user sent literally, without interpreting Markdown', async () => {
    await render(<MessageBubble role="user" text="Please use **stars** and `ticks`" />);

    expect(screen.getByText('Please use **stars** and `ticks`')).toBeOnTheScreen();
  });

  it('keeps a reply that is still streaming as plain text', async () => {
    await render(<MessageBubble role="assistant" text="Partial **bold**" streaming />);

    expect(screen.getByText('Partial **bold**')).toBeOnTheScreen();
  });

  it('lets a screen reader reach each link: a bubble with links is not one grouped element', async () => {
    await render(<MessageBubble role="assistant" text="See [the docs](https://example.com/docs) and [faq](https://example.com/faq)." />);

    expect(screen.getByRole('link', { name: 'the docs' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'faq' })).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Bot: /)).toBeNull();
  });

  it('stays one grouped element when its only link is not openable (shown as plain text)', async () => {
    await render(<MessageBubble role="assistant" text="[x](javascript:alert(1))" />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByLabelText('Bot: x')).toHaveProp('accessible', true);
  });

  it('reads a grouped reply as plain text, without Markdown syntax', async () => {
    await render(<MessageBubble role="assistant" text={'# Plan\n\n- **first** step\n- run `make`'} />);

    expect(screen.getByLabelText('Bot: Plan\nfirst step\nrun make')).toHaveProp('accessible', true);
  });

  it('keeps the label of user lines and streaming replies literal', async () => {
    await render(<MessageBubble role="user" text="**hi**" />);
    expect(screen.getByLabelText('You: **hi**')).toBeOnTheScreen();

    await render(<MessageBubble role="assistant" text="Partial **bold**" streaming />);
    expect(screen.getByLabelText('Bot: Partial **bold**')).toBeOnTheScreen();
  });

  it('lexes a reply once for its links, label and rendering', async () => {
    const lex = jest.spyOn(Lexer.prototype, 'lex');
    try {
      await render(<MessageBubble role="assistant" text="Some **bold** text" />);
      expect(lex).toHaveBeenCalledTimes(1);
    } finally {
      lex.mockRestore();
    }
  });
});
