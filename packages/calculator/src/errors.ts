/** Base error for all calculator failures (tokenize, parse, evaluate). */
export class CalcError extends Error {}

/** Raised during tokenisation; a subtype of CalcError so callers catch one type. */
export class TokenizeError extends CalcError {}
