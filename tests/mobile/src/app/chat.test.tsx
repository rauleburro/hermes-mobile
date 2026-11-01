import { render, screen } from '@testing-library/react-native';
import ChatScreen from '@mobile/app/chat/[sessionId]';
import { getMessages } from '@mobile/lib/bff';

// The screen needs route params, a theme and Stack.Screen from expo-router.
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ sessionId: 'session-1', title: 'Bot Chat' }),
  useTheme: () => ({ dark: false, colors: { text: 'black', border: 'gray', primary: 'blue', card: 'white' } }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@mobile/lib/bff', () => ({
  getMessages: jest.fn(),
  sendMessage: jest.fn(),
  followRun: jest.fn(),
  resolveApproval: jest.fn(),
  stopRun: jest.fn(),
}));

const mockedGetMessages = jest.mocked(getMessages);

describe('ChatScreen message rendering', () => {
  beforeEach(() => {
    mockedGetMessages.mockResolvedValue([
      { id: 1, role: 'user', content: 'Please use **stars** and `ticks`' },
      { id: 2, role: 'assistant', content: 'Sure, **bold** reply' },
    ] as never);
  });

  it('shows what the user sent as plain text, without interpreting Markdown', async () => {
    await render(<ChatScreen />);

    expect(await screen.findByText('Please use **stars** and `ticks`')).toBeOnTheScreen();
  });

  it('renders assistant replies as Markdown', async () => {
    await render(<ChatScreen />);

    expect(await screen.findByText('bold')).toBeOnTheScreen();
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
  });
});
