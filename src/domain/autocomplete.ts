/** Quick-add autocomplete for `#tag` and `~List` tokens: pure text logic, the UI lives in TokenSuggest. */

export type Sigil = "#" | "~";
/** The token being typed: `start` is the sigil's index, `end` where the token's characters stop. */
export type Token = { sigil: Sigil; query: string; start: number; end: number };

const TOKEN_CHAR = /[\p{L}\p{N}_\-/]/u;
const key = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** The `#…`/`~…` token the caret sits in or at the end of, or null. Matches the parser's token rules. */
export function tokenAt(text: string, caret: number): Token | null {
  let start = caret;
  while (start > 0 && TOKEN_CHAR.test(text[start - 1])) start--;
  const sigil = text[start - 1];
  if ((sigil !== "#" && sigil !== "~") || (start > 1 && !/\s/.test(text[start - 2]))) return null;
  let end = caret;
  while (end < text.length && TOKEN_CHAR.test(text[end])) end++;
  return { sigil, query: text.slice(start, caret), start: start - 1, end };
}

/** Names that complete `query`: prefix matches first, then other substring matches; never the exact name already typed. */
export function suggest(query: string, names: readonly string[], limit = 6): string[] {
  const q = key(query);
  const hits = names.filter((n) => key(n).includes(q) && key(n) !== q);
  const prefix = hits.filter((n) => key(n).startsWith(q));
  return [...prefix, ...hits.filter((n) => !prefix.includes(n))].slice(0, limit);
}

/** Replaces the token with the picked name (spaces dropped, as the parser ignores them) plus one space. */
export function complete(text: string, token: Token, name: string): { text: string; caret: number } {
  const ins = `${token.sigil}${name.replace(/\s+/g, "")}`;
  const rest = text.slice(token.end).replace(/^ /, "");
  return { text: `${text.slice(0, token.start)}${ins} ${rest}`, caret: token.start + ins.length + 1 };
}
