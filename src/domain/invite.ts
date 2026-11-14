/*
 * Invite links (PLAN D261): `momentum://invite/<code>`, or the GitHub Pages redirect page
 * `https://prpiece.github.io/momentum/invite/?c=<code>` until the domain exists.
 */

export const INVITE_PAGE = "https://prpiece.github.io/momentum/invite/";
const CODE = /^[A-Za-z0-9]{10}$/;

export const isInviteCode = (s: unknown): s is string => typeof s === "string" && CODE.test(s);

/** The link to share for a code: the web page, which opens the app or offers the download. */
export const inviteUrl = (code: string): string => `${INVITE_PAGE}?c=${code}`;

/** The code in an invite link (app link, web page, or a bare code someone pasted), or null. */
export function inviteCodeFrom(text: string): string | null {
  const t = text.trim();
  if (isInviteCode(t)) return t;
  const app = /^momentum:\/\/invite\/([A-Za-z0-9]{10})\/?$/.exec(t);
  if (app) return app[1];
  try {
    const u = new URL(t);
    if (`${u.origin}${u.pathname}`.replace(/\/?$/, "/") !== INVITE_PAGE) return null;
    const c = u.searchParams.get("c");
    return isInviteCode(c) ? c : null;
  } catch {
    return null;
  }
}

/** Handles are 3–20 of a–z, 0–9 and _ (D128); a leading @ is allowed when typing one. */
export function handleFrom(text: string): string | null {
  const h = text.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(h) ? h : null;
}
