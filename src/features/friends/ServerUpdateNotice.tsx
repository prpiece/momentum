import { SERVER_UPDATE_MESSAGE } from "../../domain/serverStatus";

/** Shown in place of sharing and connections when the server is behind the app (D289). */
export function ServerUpdateNotice() {
  return (
    <div role="status" className="card space-y-1">
      <p className="font-medium">{SERVER_UPDATE_MESSAGE}</p>
      <p className="text-[length:var(--fs-sm)] text-muted">Your tasks keep syncing. Friends, shares, sent tasks and connections work again once the server is updated.</p>
    </div>
  );
}
