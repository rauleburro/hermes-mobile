import { createSseParser, type SseFrame } from '@mobile/lib/sse';

function collect() {
  const frames: SseFrame[] = [];
  const feed = createSseParser((f) => frames.push(f));
  return { frames, feed };
}

describe('createSseParser', () => {
  it('parses a frame with id, event and data', () => {
    const { frames, feed } = collect();
    feed('id: 7\nevent: message.delta\ndata: {"text":"hi"}\n\n');
    expect(frames).toEqual([{ id: '7', event: 'message.delta', data: '{"text":"hi"}' }]);
  });

  it('joins multi-line data with newlines', () => {
    const { frames, feed } = collect();
    feed('data: line one\ndata: line two\n\n');
    expect(frames).toEqual([{ data: 'line one\nline two' }]);
  });

  it('buffers a frame split across chunks, even mid-line', () => {
    const { frames, feed } = collect();
    feed('id: 1\neve');
    feed('nt: run.started\nda');
    expect(frames).toHaveLength(0);
    feed('ta: ok\n');
    expect(frames).toHaveLength(0);
    feed('\n');
    expect(frames).toEqual([{ id: '1', event: 'run.started', data: 'ok' }]);
  });

  it('emits several frames from one chunk, in order', () => {
    const { frames, feed } = collect();
    feed('data: a\n\ndata: b\n\ndata: c\n\n');
    expect(frames.map((f) => f.data)).toEqual(['a', 'b', 'c']);
  });

  it('normalizes CRLF line endings', () => {
    const { frames, feed } = collect();
    feed('id: 2\r\ndata: x\r\n\r\n');
    expect(frames).toEqual([{ id: '2', data: 'x' }]);
  });

  it('handles a CRLF pair split across chunks', () => {
    const { frames, feed } = collect();
    feed('data: y\r\n\r');
    feed('\n');
    expect(frames).toEqual([{ data: 'y' }]);
  });

  it('ignores comment lines (keepalive) and comment-only frames', () => {
    const { frames, feed } = collect();
    feed(': keepalive\n\n');
    feed(': stream closed\ndata: real\n\n');
    expect(frames).toEqual([{ data: 'real' }]);
  });

  it('drops frames without data', () => {
    const { frames, feed } = collect();
    feed('id: 9\nevent: ping\n\n');
    expect(frames).toEqual([]);
  });

  it('strips only one leading space from values', () => {
    const { frames, feed } = collect();
    feed('data:no-space\n\ndata:  two-spaces\n\n');
    expect(frames.map((f) => f.data)).toEqual(['no-space', ' two-spaces']);
  });

  it('keeps colons inside the value', () => {
    const { frames, feed } = collect();
    feed('data: {"a":"b:c"}\n\n');
    expect(frames[0].data).toBe('{"a":"b:c"}');
  });

  it('treats a data line without a colon as an empty data value', () => {
    const { frames, feed } = collect();
    feed('data\n\n');
    expect(frames).toEqual([{ data: '' }]);
  });

  it('ignores unknown fields', () => {
    const { frames, feed } = collect();
    feed('retry: 3000\nfoo: bar\ndata: z\n\n');
    expect(frames).toEqual([{ data: 'z' }]);
  });

  it('keeps the last id and event when repeated in one frame', () => {
    const { frames, feed } = collect();
    feed('id: 1\nid: 2\nevent: a\nevent: b\ndata: d\n\n');
    expect(frames).toEqual([{ id: '2', event: 'b', data: 'd' }]);
  });

  it('does not emit a trailing frame that has not been terminated', () => {
    const { frames, feed } = collect();
    feed('data: partial\n');
    expect(frames).toEqual([]);
  });
});
