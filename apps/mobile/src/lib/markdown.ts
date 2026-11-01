import { Lexer, type Token, type Tokens } from 'marked';

// Parsing for assistant replies written in Markdown, shared by the renderer
// (components/Markdown.tsx) and plain-text uses (previews, screen-reader labels).

// Only these open in the system browser. Anything else (app deep links, javascript:)
// stays plain text so a reply cannot drive the app.
export const OPENABLE = /^(https?:|mailto:)/i;

// Guards against hostile or degenerate replies. A reply that trips one is shown as
// plain text instead of crashing the chat or freezing the JS thread.
// - Size: real replies are a few KB; 30 KB is ~10 screens of text. Beyond that we skip
//   parsing entirely (linear cost guard, and it bounds deep-list inputs too).
const MAX_LENGTH = 30_000;
// - Emphasis: marked's emphasis matching is quadratic in the delimiters of one
//   paragraph (8000 `_a ` takes minutes). 200 `*`/`_`/`~` in one paragraph is far more
//   than any real prose and lexes in a few ms; denser paragraphs stay plain text.
const MAX_INLINE_DELIMITERS = 200;
// - Nesting: blockquotes and lists deeper than this render their source as plain text.
export const MAX_DEPTH = 8;

class GuardedLexer extends Lexer {
  override inlineTokens(src: string, tokens: Token[] = []): Token[] {
    if (countDelimiters(src) > MAX_INLINE_DELIMITERS) {
      tokens.push({ type: 'text', raw: src, text: src } as Tokens.Text);
      return tokens;
    }
    return super.inlineTokens(src, tokens);
  }
}

function countDelimiters(src: string): number {
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 42 || c === 95 || c === 126) n++; // * _ ~
  }
  return n;
}

/** Tokens for `text`, or null when it must be shown as plain text. */
export function parseMarkdown(text: string): Token[] | null {
  if (text.length > MAX_LENGTH) return null;
  try {
    return new GuardedLexer().lex(text);
  } catch {
    // e.g. RangeError (stack overflow) on thousands of nested blockquotes.
    return null;
  }
}

/**
 * Whether `text` renders at least one link that can be opened (http/https/mailto).
 * Containers use it to avoid grouping a reply into one accessibility element, which
 * would hide its links from screen readers.
 */
export function hasOpenableLinks(text: string): boolean {
  const tokens = parseMarkdown(text);
  return tokens ? tokens.some((token) => containsOpenableLink(token)) : false;
}

/** Counts nesting like the renderer: lists and quotes at MAX_DEPTH show as plain text. */
function containsOpenableLink(token: Token, depth = 0): boolean {
  if (token.type === 'link' && OPENABLE.test((token as Tokens.Link).href)) return true;
  const nests = token.type === 'list' || token.type === 'blockquote';
  if (nests && depth >= MAX_DEPTH) return false;
  const children: Token[] = [
    ...(('tokens' in token && Array.isArray(token.tokens) ? token.tokens : []) as Token[]),
    ...(token.type === 'list' ? (token as Tokens.List).items : []),
  ];
  return children.some((child) => containsOpenableLink(child, nests ? depth + 1 : depth));
}
