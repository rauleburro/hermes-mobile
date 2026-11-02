import { render, screen, userEvent } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';
import { RESULT_PREVIEW_MAX, ToolCard } from '@mobile/components/ToolCard';
import { colors } from '@mobile/theme';

const styleOf = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) ?? {};

afterEach(() => jest.restoreAllMocks());

describe('ToolCard theme', () => {
  it.each(['light', 'dark'] as const)('sits on the surface color with the %s theme text and accent spinner', async (scheme) => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
    await render(<ToolCard name="clock" args="tz: UTC" rawArgs="" status="running" />);

    const card = screen.getByLabelText('Tool clock, tz: UTC, running');
    expect(styleOf(card)).toMatchObject({ backgroundColor: colors[scheme].surface, borderColor: colors[scheme].separator });
    expect(styleOf(screen.getByText('clock')).color).toBe(colors[scheme].text);
    expect(styleOf(screen.getByText('tz: UTC')).color).toBe(colors[scheme].textSecondary);
    expect(screen.getByTestId('tool-spinner')).toHaveProp('color', colors[scheme].accent);
  });
});

describe('ToolCard', () => {
  it('shows the tool name, the args summary and a spinner while running, all in its label', async () => {
    await render(<ToolCard name="clock" args="tz: UTC" rawArgs='{"tz":"UTC"}' status="running" />);

    expect(screen.getByLabelText('Tool clock, tz: UTC, running')).toBeOnTheScreen();
    expect(screen.getByText('clock')).toBeOnTheScreen();
    expect(screen.getByText('tz: UTC')).toBeOnTheScreen();
    expect(screen.getByTestId('tool-spinner')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is collapsed when done and expands to the full args and the result on press, then collapses again', async () => {
    await render(<ToolCard name="clock" args="tz: UTC" rawArgs='{"tz":"UTC"}' status="done" result="12:00 UTC" />);
    const header = screen.getByRole('button', { name: 'Tool clock, tz: UTC, done' });

    expect(screen.queryByTestId('tool-spinner')).toBeNull();
    expect(screen.queryByText('12:00 UTC')).toBeNull();
    expect(header).not.toBeExpanded();

    await userEvent.setup().press(header);
    expect(screen.getByText('12:00 UTC')).toBeOnTheScreen();
    expect(screen.getByText('{"tz":"UTC"}')).toBeOnTheScreen();
    expect(header).toBeExpanded();

    await userEvent.setup().press(header);
    expect(screen.queryByText('12:00 UTC')).toBeNull();
  });

  it('keeps the expanded result outside the labelled header, so a screen reader reads it', async () => {
    await render(<ToolCard name="clock" args="" rawArgs="" status="done" result="12:00 UTC" />);
    const header = screen.getByRole('button', { name: 'Tool clock, done' });

    await userEvent.setup().press(header);

    const result = screen.getByTestId('tool-result');
    let node = result.parent;
    while (node) {
      expect(node).not.toBe(header);
      node = node.parent;
    }
  });

  it('truncates a long result when expanded', async () => {
    const long = 'x'.repeat(RESULT_PREVIEW_MAX + 50);
    await render(<ToolCard name="read" args="" rawArgs="" status="done" result={long} />);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Tool read, done' }));

    expect(screen.getByTestId('tool-result')).toHaveTextContent(`${'x'.repeat(RESULT_PREVIEW_MAX - 1)}…`);
  });

  it('says when a call from the history ended without a result, and is not expandable', async () => {
    await render(<ToolCard name="clock" args="" rawArgs="" status="no-result" />);

    expect(screen.getByLabelText('Tool clock, no result')).toBeOnTheScreen();
    expect(screen.getByText('no result')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('tool-spinner')).toBeNull();
  });
});
