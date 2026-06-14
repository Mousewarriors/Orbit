/**
 * Recursive-descent / Pratt parser + evaluator for arithmetic expressions.
 *
 * Crucially this performs NO code evaluation (no `eval`, no `Function`). The
 * input is tokenised and walked over an explicit grammar, so a malicious string
 * can at worst produce a parse error — never execute code.
 *
 * Grammar (precedence low→high):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := ('-' | '+') unary | power
 *   power   := postfix ('^' unary)?        (right-assoc)
 *   postfix := primary '%'?                (trailing percent → value/100)
 *   primary := number | ident | func '(' args ')' | '(' expr ')'
 */

import { tokenize, type Token } from './tokenizer.js';
import { CalcError } from './errors.js';

export { CalcError } from './errors.js';

const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

type Fn1 = (x: number) => number;
const FUNCTIONS: Readonly<Record<string, Fn1>> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  deg: (x) => (x * 180) / Math.PI,
  rad: (x) => (x * Math.PI) / 180,
};

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private next(): Token {
    return this.tokens[this.pos++]!;
  }
  private expect(type: Token['type']): Token {
    const t = this.peek();
    if (t.type !== type) throw new CalcError(`Expected ${type} but got '${t.value || 'end'}'`);
    return this.next();
  }

  parse(): number {
    const v = this.expr();
    if (this.peek().type !== 'eof') {
      throw new CalcError(`Unexpected '${this.peek().value}'`);
    }
    return v;
  }

  private expr(): number {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t.type === 'plus') {
        this.next();
        left += this.term();
      } else if (t.type === 'minus') {
        this.next();
        left -= this.term();
      } else break;
    }
    return left;
  }

  private term(): number {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'star') {
        this.next();
        left *= this.unary();
      } else if (t.type === 'slash') {
        this.next();
        const r = this.unary();
        if (r === 0) throw new CalcError('Division by zero');
        left /= r;
      } else break;
    }
    return left;
  }

  private unary(): number {
    const t = this.peek();
    if (t.type === 'minus') {
      this.next();
      return -this.unary();
    }
    if (t.type === 'plus') {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.postfix();
    if (this.peek().type === 'caret') {
      this.next();
      const exp = this.unary(); // right-assoc
      return Math.pow(base, exp);
    }
    return base;
  }

  private postfix(): number {
    let v = this.primary();
    if (this.peek().type === 'percent') {
      this.next();
      v = v / 100;
    }
    return v;
  }

  private primary(): number {
    const t = this.peek();
    if (t.type === 'number') {
      this.next();
      const n = Number(t.value);
      if (!Number.isFinite(n)) throw new CalcError(`Invalid number '${t.value}'`);
      return n;
    }
    if (t.type === 'lparen') {
      this.next();
      const v = this.expr();
      this.expect('rparen');
      return v;
    }
    if (t.type === 'ident') {
      this.next();
      const name = t.value.toLowerCase();
      if (this.peek().type === 'lparen') {
        this.next();
        const args: number[] = [];
        if (this.peek().type !== 'rparen') {
          args.push(this.expr());
          while (this.peek().type === 'comma') {
            this.next();
            args.push(this.expr());
          }
        }
        this.expect('rparen');
        return this.callFunction(name, args);
      }
      if (name in CONSTANTS) return CONSTANTS[name]!;
      throw new CalcError(`Unknown identifier '${t.value}'`);
    }
    throw new CalcError(`Unexpected '${t.value || 'end of input'}'`);
  }

  private callFunction(name: string, args: number[]): number {
    if (name === 'min') return Math.min(...args);
    if (name === 'max') return Math.max(...args);
    if (name === 'pow') {
      if (args.length !== 2) throw new CalcError('pow() expects 2 arguments');
      return Math.pow(args[0]!, args[1]!);
    }
    const fn = FUNCTIONS[name];
    if (!fn) throw new CalcError(`Unknown function '${name}'`);
    if (args.length !== 1) throw new CalcError(`${name}() expects 1 argument`);
    return fn(args[0]!);
  }
}

/** Evaluate a pure arithmetic expression. Throws CalcError on invalid input. */
export function evaluate(input: string): number {
  const tokens = tokenize(input);
  const result = new Parser(tokens).parse();
  if (!Number.isFinite(result)) throw new CalcError('Result is not a finite number');
  return result;
}

export const KNOWN_FUNCTIONS = Object.freeze(
  Object.keys(FUNCTIONS).concat(['min', 'max', 'pow']),
);
export const KNOWN_CONSTANTS = Object.freeze(Object.keys(CONSTANTS));
