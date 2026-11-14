import { requestCount, useSocial } from "../../stores/social";

/** The count of things waiting on you, beside Friends in the navigation. */
export function RequestBadge() {
  const n = useSocial(requestCount);
  return n > 0 ? (
    <span className="badge bg-accent text-accent-fg" aria-label={`${n} waiting`}>
      {n}
    </span>
  ) : null;
}
