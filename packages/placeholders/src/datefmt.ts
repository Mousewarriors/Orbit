/** Minimal, dependency-free date formatter supporting common tokens. */

const PAD = (n: number, len = 2) => String(n).padStart(len, '0');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Format a date with tokens: yyyy yy MMMM MMM MM M dd d HH H mm ss EEEE EEE a hh.
 * Unknown text is passed through. Tokens are matched longest-first.
 */
export function formatDate(date: Date, pattern: string): string {
  const tokens: Array<[string, () => string]> = [
    ['yyyy', () => String(date.getFullYear())],
    ['yy', () => PAD(date.getFullYear() % 100)],
    ['MMMM', () => MONTHS[date.getMonth()]!],
    ['MMM', () => MONTHS[date.getMonth()]!.slice(0, 3)],
    ['MM', () => PAD(date.getMonth() + 1)],
    ['M', () => String(date.getMonth() + 1)],
    ['dd', () => PAD(date.getDate())],
    ['d', () => String(date.getDate())],
    ['EEEE', () => DAYS[date.getDay()]!],
    ['EEE', () => DAYS[date.getDay()]!.slice(0, 3)],
    ['HH', () => PAD(date.getHours())],
    ['H', () => String(date.getHours())],
    ['hh', () => PAD(((date.getHours() + 11) % 12) + 1)],
    ['h', () => String(((date.getHours() + 11) % 12) + 1)],
    ['mm', () => PAD(date.getMinutes())],
    ['ss', () => PAD(date.getSeconds())],
    ['a', () => (date.getHours() < 12 ? 'AM' : 'PM')],
  ];

  let out = '';
  let i = 0;
  outer: while (i < pattern.length) {
    for (const [tok, fn] of tokens) {
      if (pattern.startsWith(tok, i)) {
        out += fn();
        i += tok.length;
        continue outer;
      }
    }
    out += pattern[i];
    i++;
  }
  return out;
}
