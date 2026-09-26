/**
 * Rule conditions (spec §8 "Sistema de eventos"): signal names combined with
 * `and`, `or`, `not` and parentheses, e.g. "plate1.pressed and not flag_x".
 */

export type Expr =
  { op: 'id'; name: string } | { op: 'not'; a: Expr } | { op: 'and' | 'or'; a: Expr; b: Expr };

export function parseExpr(src: string): Expr {
  const tokens = src.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const next = (): string => {
    const t = tokens[i++];
    if (t === undefined) throw new Error(`Unexpected end of condition: "${src}"`);
    return t;
  };

  const primary = (): Expr => {
    const t = next();
    if (t === '(') {
      const e = orExpr();
      if (next() !== ')') throw new Error(`Missing ')' in "${src}"`);
      return e;
    }
    if (t === 'not') return { op: 'not', a: primary() };
    if (t === 'and' || t === 'or' || t === ')') throw new Error(`Unexpected '${t}' in "${src}"`);
    return { op: 'id', name: t };
  };
  const andExpr = (): Expr => {
    let e = primary();
    while (peek() === 'and') {
      i++;
      e = { op: 'and', a: e, b: primary() };
    }
    return e;
  };
  const orExpr = (): Expr => {
    let e = andExpr();
    while (peek() === 'or') {
      i++;
      e = { op: 'or', a: e, b: andExpr() };
    }
    return e;
  };

  const e = orExpr();
  if (i !== tokens.length) throw new Error(`Unexpected '${tokens[i]}' in "${src}"`);
  return e;
}

export function evalExpr(e: Expr, lookup: (name: string) => boolean): boolean {
  switch (e.op) {
    case 'id':
      return lookup(e.name);
    case 'not':
      return !evalExpr(e.a, lookup);
    case 'and':
      return evalExpr(e.a, lookup) && evalExpr(e.b, lookup);
    case 'or':
      return evalExpr(e.a, lookup) || evalExpr(e.b, lookup);
  }
}

/** Every signal or flag name a condition refers to. */
export function exprNames(e: Expr): string[] {
  switch (e.op) {
    case 'id':
      return [e.name];
    case 'not':
      return exprNames(e.a);
    default:
      return [...exprNames(e.a), ...exprNames(e.b)];
  }
}

/** Parses durations like "2s" or "1.5s" into seconds. */
export function parseSeconds(token: string | undefined): number | null {
  if (!token) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(token);
  return m ? Number(m[1]) : null;
}
