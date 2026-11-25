/* ============================================================
   format.ts — the one formatting helper the ported logic modules
   depend on. In the vanilla app `fmt` lived in app.js as a global;
   investigate.js and tickets.js both call it, and the regression
   suite shims it into its vm context verbatim. Same body here.
   ============================================================ */

/** Legacy `fmt` from app.js line 24. Em dash for null; one decimal otherwise. */
export function fmt(n: number | null | undefined): string | number {
  return n == null ? '—' : Math.round(n * 10) / 10;
}
