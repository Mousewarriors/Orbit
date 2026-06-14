/** Token stream for the arithmetic parser. No regex on the hot path. */

export type TokenType =
  | 'number'
  | 'ident'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'caret'
  | 'percent'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof';

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly pos: number;
}

const SINGLE: Readonly<Record<string, TokenType>> = {
  '+': 'plus',
  '-': 'minus',
  '*': 'star',
  '×': 'star',
  '/': 'slash',
  '÷': 'slash',
  '^': 'caret',
  '%': 'percent',
  '(': 'lparen',
  ')': 'rparen',
  ',': 'comma',
};

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

export { TokenizeError } from './errors.js';
import { TokenizeError } from './errors.js';

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t' || ch === '_' /* digit grouping like 1_000 handled below */) {
      // underscores only valid inside numbers; treat lone ones as separators
      i++;
      continue;
    }
    if (ch === ',') {
      // Thousands separator between digits is ignored; otherwise a comma token.
      const prev = input[i - 1];
      const next = input[i + 1];
      if (prev && isDigit(prev) && next && isDigit(next)) {
        i++;
        continue;
      }
      tokens.push({ type: 'comma', value: ',', pos: i });
      i++;
      continue;
    }
    const single = SINGLE[ch];
    if (single) {
      tokens.push({ type: single, value: ch, pos: i });
      i++;
      continue;
    }
    if (isDigit(ch) || (ch === '.' && isDigit(input[i + 1] ?? ''))) {
      const start = i;
      let seenDot = false;
      let seenExp = false;
      while (i < input.length) {
        const c = input[i]!;
        if (isDigit(c)) {
          i++;
        } else if (c === '.' && !seenDot && !seenExp) {
          seenDot = true;
          i++;
        } else if ((c === 'e' || c === 'E') && !seenExp && i > start && isDigitOrSign(input[i + 1])) {
          seenExp = true;
          i++;
          if (input[i] === '+' || input[i] === '-') i++;
        } else if ((c === '_' || c === ',') && isDigit(input[i + 1] ?? '')) {
          // digit grouping inside a number, only when a digit follows (so a
          // trailing comma like "max(3, 7)" is not swallowed)
          i++;
        } else {
          break;
        }
      }
      tokens.push({ type: 'number', value: input.slice(start, i).replace(/[_,]/g, ''), pos: start });
      continue;
    }
    if (isIdentStart(ch)) {
      const start = i;
      while (i < input.length && (isIdentStart(input[i]!) || isDigit(input[i]!))) i++;
      tokens.push({ type: 'ident', value: input.slice(start, i), pos: start });
      continue;
    }
    throw new TokenizeError(`Unexpected character '${ch}' at ${i}`);
  }
  tokens.push({ type: 'eof', value: '', pos: input.length });
  return tokens;
}

function isDigitOrSign(ch: string | undefined): boolean {
  return !!ch && (isDigit(ch) || ch === '+' || ch === '-');
}
