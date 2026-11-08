export type KeyPart = { kind: "key" | "text"; value: string };

const SEPARATORS = new Set(["/", "or"]);

/**
 * Splits a binding as written in the feature registry into keycaps and plain text (D198):
 * "Ctrl Shift A" and "Ctrl + Shift + A" give one key each; "/" and "or" between alternatives,
 * and lowercase words like "click", stay text. A "+" that ends a binding ("Ctrl +") is a key.
 */
export function keyParts(keys: string): KeyPart[] {
  const tokens = keys.trim().split(/\s+/).filter(Boolean);
  return tokens.flatMap((t, i): KeyPart[] => {
    const next = tokens[i + 1];
    if (t === "+" && next !== undefined && !SEPARATORS.has(next)) return [];
    if (SEPARATORS.has(t) || /^[a-z]{2,}$/.test(t)) return [{ kind: "text", value: t }];
    return [{ kind: "key", value: t }];
  });
}

const MAC_KEYS: Record<string, string> = { Ctrl: "⌘", Alt: "⌥", Shift: "⇧" };

/** The macOS spelling of a binding written for Windows/Linux: Ctrl is Cmd (the app treats both as the modifier), Alt is Option. */
export function macKeys(keys: string): string {
  return keys.replace(/\b(Ctrl|Alt|Shift)\b/g, (k) => MAC_KEYS[k]);
}
