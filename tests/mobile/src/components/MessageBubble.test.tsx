import { render, screen } from '@testing-library/react-native';
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
});
