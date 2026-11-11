/**
 * "Which occurrences?" for edits and deletes on a recurring task or event. Each app plugs in its
 * own prompt (desktop: the scope dialog in stores/ui; phone: an alert). Resolves null on cancel.
 */
import type { Scope } from "./data";

export type ScopeVerb = "edit" | "delete";
let ask: (verb: ScopeVerb) => Promise<Scope | null> = async () => null;
export const setScopeAsker = (fn: typeof ask) => void (ask = fn);
export const askScope = (verb: ScopeVerb) => ask(verb);
