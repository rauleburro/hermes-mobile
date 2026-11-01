import type { SessionMessage } from '@hermes-mobile/api';
import { buildChatItems, isFinalAnswer, maxRowId, mergeRows, summarizeArgs, truncate } from '@mobile/lib/chatItems';

const call = (id: string, name: string, args: unknown = {}) => ({
  id,
  call_id: id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

const turn: SessionMessage[] = [
  { id: 10, role: 'user', content: 'what time is it?' },
  { id: 11, role: 'assistant', content: 'Let me check.', tool_calls: [call('call_a', 'clock', { tz: 'UTC' })], finish_reason: 'tool_calls' },
  { id: 12, role: 'tool', content: '12:00 UTC', tool_call_id: 'call_a', tool_name: 'clock' },
  { id: 13, role: 'assistant', content: 'It is noon.', finish_reason: 'stop' },
];

describe('mergeRows', () => {
  it('appends rows it has not seen and dedups on id', () => {
    const merged = mergeRows(turn.slice(0, 2), turn.slice(1, 3));
    expect(merged.map((r) => r.id)).toEqual([10, 11, 12]);
  });

  it('keeps id-less rows it already holds and returns the same array when nothing is new', () => {
    const current: SessionMessage[] = [{ role: 'user', content: 'legacy' }, ...turn.slice(0, 1)];
    expect(mergeRows(current, turn.slice(0, 1))).toBe(current);
  });

  it('updates a row it already holds when the poll brings a newer copy', () => {
    const merged = mergeRows(turn.slice(0, 1), [{ id: 10, role: 'user', content: 'edited' }]);
    expect(merged).toEqual([{ id: 10, role: 'user', content: 'edited' }]);
  });
});

describe('maxRowId', () => {
  it('is the largest numeric id, or -Infinity when rows carry none', () => {
    expect(maxRowId(turn)).toBe(13);
    expect(maxRowId([{ role: 'user', content: 'x' }])).toBe(-Infinity);
  });
});

describe('isFinalAnswer', () => {
  it('is an assistant row with text and no tool calls', () => {
    expect(isFinalAnswer(turn[3])).toBe(true);
    expect(isFinalAnswer(turn[1])).toBe(false);
    expect(isFinalAnswer(turn[0])).toBe(false);
  });

  it('is not a fragment cut at the length limit (truncation recovery appends text-only partials)', () => {
    expect(isFinalAnswer({ id: 1, role: 'assistant', content: 'partial…', finish_reason: 'length' })).toBe(false);
    // Any other reason (or none) still counts: `stop` is not required.
    expect(isFinalAnswer({ id: 2, role: 'assistant', content: 'done', finish_reason: null })).toBe(true);
    expect(isFinalAnswer({ id: 3, role: 'assistant', content: 'done', finish_reason: 'end_turn' })).toBe(true);
  });
});

describe('buildChatItems', () => {
  it('renders interim text, then a done card holding the matching tool result, then the answer', () => {
    expect(buildChatItems(turn)).toEqual([
      { kind: 'message', key: 'm-10', role: 'user', text: 'what time is it?' },
      { kind: 'message', key: 'm-11', role: 'assistant', text: 'Let me check.' },
      { kind: 'tool', key: 't-11-call_a', name: 'clock', args: 'tz: UTC', rawArgs: '{"tz":"UTC"}', status: 'done', result: '12:00 UTC' },
      { kind: 'message', key: 'm-13', role: 'assistant', text: 'It is noon.' },
    ]);
  });

  it('shows a call without a result as running only when it belongs to the live turn', () => {
    const rows = turn.slice(0, 2);
    const tool = (liveAfterId?: number) =>
      buildChatItems(rows, { liveAfterId }).find((i) => i.kind === 'tool');

    expect(tool(9)).toMatchObject({ status: 'running' });
    expect(tool(11)).toMatchObject({ status: 'no-result' });
    expect(tool(undefined)).toMatchObject({ status: 'no-result' });
  });

  it('matches a result on call_id when the call id differs', () => {
    const rows: SessionMessage[] = [
      { id: 1, role: 'assistant', content: '', tool_calls: [{ id: 'fc_1', call_id: 'call_1', function: { name: 'clock' } }] },
      { id: 2, role: 'tool', content: 'done', tool_call_id: 'call_1' },
    ];
    expect(buildChatItems(rows)).toEqual([
      { kind: 'tool', key: 't-1-fc_1', name: 'clock', args: '', rawArgs: '', status: 'done', result: 'done' },
    ]);
  });

  it('skips hidden rows, system rows, orphan tool rows and empty text', () => {
    const rows: SessionMessage[] = [
      { id: 1, role: 'user', content: '[System: scaffold]', display_kind: 'hidden' },
      { id: 2, role: 'assistant', content: 'secret handoff', display_kind: 'hidden', tool_calls: [call('h', 'x')] },
      { id: 3, role: 'system', content: 'prompt' },
      { id: 4, role: 'tool', content: 'orphan', tool_call_id: 'nope' },
      { id: 5, role: 'assistant', content: '' },
      { id: 6, role: 'user', content: 'visible' },
    ];
    expect(buildChatItems(rows)).toEqual([{ kind: 'message', key: 'm-6', role: 'user', text: 'visible' }]);
  });

  it('matches a result only within its own turn, so a repeated call id never borrows an older result', () => {
    const rows: SessionMessage[] = [
      { id: 1, role: 'user', content: 'first' },
      { id: 2, role: 'assistant', content: '', tool_calls: [call('call_0', 'clock')] },
      { id: 3, role: 'tool', content: 'old result', tool_call_id: 'call_0' },
      { id: 4, role: 'assistant', content: 'one' },
      { id: 5, role: 'user', content: 'second' },
      // Same id again (deterministic ids for blank provider ids, or after compaction).
      { id: 6, role: 'assistant', content: '', tool_calls: [call('call_0', 'clock')] },
    ];
    const tools = buildChatItems(rows, { liveAfterId: 5 }).filter((i) => i.kind === 'tool');

    expect(tools).toEqual([
      expect.objectContaining({ key: 't-2-call_0', status: 'done', result: 'old result' }),
      expect.objectContaining({ key: 't-6-call_0', status: 'running' }),
    ]);
    expect(tools[1]).not.toHaveProperty('result');
  });

  it('does not take a result that comes before the call', () => {
    const rows: SessionMessage[] = [
      { id: 1, role: 'tool', content: 'stray', tool_call_id: 'call_a' },
      { id: 2, role: 'assistant', content: '', tool_calls: [call('call_a', 'clock')] },
    ];
    expect(buildChatItems(rows)).toEqual([expect.objectContaining({ status: 'no-result' })]);
  });

  it("keeps the user's own Bot Chat message, which Hermes stores as internal_notification", () => {
    expect(buildChatItems([{ id: 3, role: 'user', content: '[e2e] hi', display_kind: 'internal_notification' }])).toEqual([
      { kind: 'message', key: 'm-3', role: 'user', text: '[e2e] hi' },
    ]);
  });

  it('keys id-less rows by position', () => {
    expect(buildChatItems([{ role: 'user', content: 'a' }])).toEqual([
      { kind: 'message', key: 'm-i0', role: 'user', text: 'a' },
    ]);
  });
});

describe('summarizeArgs', () => {
  it('lists the first arguments as key: value, truncated', () => {
    expect(summarizeArgs('{"path":"notes.md","limit":5}')).toBe('path: notes.md, limit: 5');
    expect(summarizeArgs(JSON.stringify({ query: 'x'.repeat(100) }))).toHaveLength(60);
    expect(summarizeArgs('{}')).toBe('');
    expect(summarizeArgs(null)).toBe('');
  });

  it('falls back to the raw text when it is not a JSON object', () => {
    expect(summarizeArgs('not json')).toBe('not json');
    expect(summarizeArgs('[1,2]')).toBe('[1,2]');
  });
});

describe('summarizeArgs masking', () => {
  it('masks secret-looking keys and values in the one-line summary', () => {
    expect(summarizeArgs('{"api_key":"sk-123","password":"hunter2","user":"ana"}')).toBe('api_key: •••, password: •••, user: ana');
    expect(summarizeArgs('{"command":"curl -H \\"Authorization: Bearer abc.def\\" x"}')).toBe('command: curl -H "Authorization: Bearer •••" x');
    expect(summarizeArgs('{"command":"PASSWORD=hunter2 TOKEN=t0k ./run"}')).toBe('command: PASSWORD=••• TOKEN=••• ./run');
    expect(summarizeArgs('export API_KEY=abc')).toBe('export API_KEY=•••');
  });

  // [what, the command the tool got, the secret that must not show, context that must stay]
  it.each([
    ['quoted env value (single)', "PGPASSWORD='s3cr3t' psql", 's3cr3t', 'psql'],
    ['quoted env value (double)', 'PASSWORD="s3cr3t" ./run', 's3cr3t', './run'],
    ['header with a key name', 'curl -H "X-Api-Key: s3cr3t" api', 's3cr3t', 'X-Api-Key'],
    ['Authorization: Basic', 'curl -H "Authorization: Basic dXNlcjpwYXNz" api', 'dXNlcjpwYXNz', 'Basic'],
    ['header in JSON form', '{"headers":{"X-Api-Key":"s3cr3t"}}', 's3cr3t', 'X-Api-Key'],
    ['credentials in a URL', 'git clone https://ana:s3cr3t@example.com/r.git', 's3cr3t', 'example.com'],
    ['curl -u user:pass', 'curl -u ana:s3cr3t https://example.com', 's3cr3t', 'ana'],
    ['--password value', 'mysql --password s3cr3t db', 's3cr3t', 'db'],
    ['--password=value', 'tool --password=s3cr3t', 's3cr3t', 'tool'],
    ['-pVALUE', 'mysql -us -ps3cr3t db', 's3cr3t', 'db'],
    ['sk- token', 'echo sk-abcdefghijklmnop', 'sk-abcdefghijklmnop', 'echo'],
    ['ghp_ token', 'gh auth ghp_abcdefghijklmnop1234', 'ghp_abcdefghijklmnop1234', 'gh'],
    ['xox token', 'post xoxb-1234567890-abcdef', 'xoxb-1234567890-abcdef', 'post'],
    ['AKIA key id', 'aws AKIAEXAMPLEKEY12345', 'AKIAEXAMPLEKEY12345', 'aws'],
  ])('masks %s', (_what, command, secret, context) => {
    const summary = summarizeArgs(JSON.stringify({ command }));
    expect(summary).not.toContain(secret);
    expect(summary).toContain('•••');
    expect(summary).toContain(context);
  });

  it('leaves ordinary arguments alone', () => {
    expect(summarizeArgs('{"command":"mkdir -p build && ls -la"}')).toBe('command: mkdir -p build && ls -la');
  });
});

describe('truncate', () => {
  it('cuts long text with an ellipsis and keeps short text as is', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
