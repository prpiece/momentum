import { openSite, SITE, type SitePage } from "../../lib/links";
import { toast } from "../../stores/ui";

/** A link to a public page (Terms, Privacy) that opens in the system browser; inside a label it doesn't toggle the checkbox. */
export function SiteLink({ page, children }: { page: SitePage; children: string }) {
  return (
    <a
      href={SITE + page}
      onClick={(e) => {
        e.preventDefault();
        void openSite(page).catch((err) => toast(`Couldn't open the page: ${String(err)}`));
      }}
      className="text-accent-text underline underline-offset-2"
    >
      {children}
    </a>
  );
}
