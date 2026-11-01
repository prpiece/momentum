import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Dialog } from "../../components/ui/Dialog";
import { takeWhatsNew, useAppVersion } from "../../lib/updater";

/** Once, after an update installs: that version's release notes (D66). */
export function WhatsNew() {
  const version = useAppVersion();
  const [news, setNews] = useState<{ version: string; notes: string } | null>(null);
  useEffect(() => {
    if (version) setNews(takeWhatsNew(version));
  }, [version]);
  if (!news) return null;
  return (
    <Dialog label={`What's new in Momentum ${news.version}`} onClose={() => setNews(null)} width="max-w-lg">
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
            <Sparkles size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-tight">What's new</h2>
            <p className="text-xs text-muted">Momentum {news.version}</p>
          </div>
        </div>
        <div className="prose-md max-h-[50vh] overflow-y-auto text-sm text-fg-2">
          <ReactMarkdown>{news.notes}</ReactMarkdown>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={() => setNews(null)} className="h-9 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent">
            Nice
          </button>
        </div>
      </div>
    </Dialog>
  );
}
