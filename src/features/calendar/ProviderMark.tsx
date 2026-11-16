import type { CalProvider } from "../../domain/types";

export const PROVIDER_NAME: Record<CalProvider, string> = { google: "Google Calendar", microsoft: "Outlook" };

/** A small letter mark on events from a connected Google or Outlook calendar (D345). */
export function ProviderMark({ provider }: { provider: CalProvider | undefined }) {
  if (!provider) return null;
  return (
    <span
      title={PROVIDER_NAME[provider]}
      className="inline-grid size-3.5 shrink-0 place-items-center rounded-xs border border-border-strong text-[9px] font-semibold leading-none text-fg-2"
    >
      {provider === "google" ? "G" : "O"}
    </span>
  );
}
