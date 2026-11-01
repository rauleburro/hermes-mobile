// Minimal SSE frame parser for fetch streams (EventSource isn't available in React Native).

export type SseFrame = { id?: string; event?: string; data: string };

export function createSseParser(onFrame: (frame: SseFrame) => void) {
  let buffer = '';
  return (chunk: string) => {
    // Normalize the whole buffer so a CRLF pair split across chunks is still joined.
    buffer = (buffer + chunk).replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const frame: SseFrame = { data: '' };
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (!line || line.startsWith(':')) continue; // comments: keepalive, "stream closed"
        const sep = line.indexOf(':');
        const field = sep === -1 ? line : line.slice(0, sep);
        const value = sep === -1 ? '' : line.slice(sep + 1).replace(/^ /, '');
        if (field === 'data') data.push(value);
        else if (field === 'id') frame.id = value;
        else if (field === 'event') frame.event = value;
      }
      if (data.length) {
        frame.data = data.join('\n');
        onFrame(frame);
      }
    }
  };
}
