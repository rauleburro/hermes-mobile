import { render, screen } from '@testing-library/react-native';
import { MessageBubble } from '@mobile/components/MessageBubble';

jest.mock('expo-router', () => ({
  useTheme: () => ({ colors: { text: 'black', border: 'gray', card: 'white', primary: 'blue' } }),
}));

describe('MessageBubble', () => {
  it('renders an assistant message, labelled as the Bot', async () => {
    await render(<MessageBubble role="assistant" text="hello" />);

    expect(screen.getByText('hello')).toBeOnTheScreen();
    expect(screen.getByLabelText('Bot message')).toBeOnTheScreen();
  });

  it('renders a user message, labelled as yours', async () => {
    await render(<MessageBubble role="user" text="hi" />);

    expect(screen.getByText('hi')).toBeOnTheScreen();
    expect(screen.getByLabelText('Your message')).toBeOnTheScreen();
  });
});
