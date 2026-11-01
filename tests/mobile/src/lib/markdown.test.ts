import { markdownToPlainText, parseMarkdown } from '@mobile/lib/markdown';

describe('markdownToPlainText', () => {
  it('drops heading, emphasis and code markers, one line per block', () => {
    expect(markdownToPlainText('# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code`.')).toBe(
      'Title\nSome bold, italic, gone and code.',
    );
  });

  it('keeps a link label and an image alt text, never their URLs', () => {
    expect(markdownToPlainText('See [the docs](https://example.com/docs) and ![a chart](https://example.com/c.png).')).toBe(
      'See the docs and a chart.',
    );
  });

  it('flattens lists, quotes and code blocks to their text', () => {
    expect(markdownToPlainText('- one\n- two\n\n1. first\n\n> quoted\n\n```js\nconst a = 1;\n```')).toBe(
      'one\ntwo\nfirst\nquoted\nconst a = 1;',
    );
  });

  it('shows nothing for reference definitions and rules, like the renderer', () => {
    expect(markdownToPlainText('Read [this][d].\n\n---\n\n[d]: https://example.com')).toBe('Read this.');
  });

  it('keeps what the renderer shows literally: raw HTML, escapes, line breaks', () => {
    expect(markdownToPlainText('a <b>x</b> \\* b  \nnext')).toBe('a <b>x</b> * b\nnext');
  });

  it('applies the parser caps: anything shown as plain text stays as written', () => {
    const large = `**big** ${'word '.repeat(7000)}`;
    expect(markdownToPlainText(large)).toBe(large);

    const dense = '*a '.repeat(300).trimEnd();
    expect(markdownToPlainText(dense)).toBe(dense);

    expect(markdownToPlainText(`${'> '.repeat(9)}[deep](https://example.com)`)).toContain('[deep](https://example.com)');
  });

  it('reuses tokens that were already parsed', () => {
    const tokens = parseMarkdown('**shared**');
    expect(markdownToPlainText('ignored', tokens)).toBe('shared');
    expect(markdownToPlainText('**as written**', null)).toBe('**as written**');
  });
});
