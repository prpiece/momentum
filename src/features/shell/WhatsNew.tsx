import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button, Dialog } from "../../components/ui/Dialog";
import { newsItems } from "../../domain/changelog";
import { takeWhatsNew, useAppVersion } from "../../lib/updater";

/**
 * Once, after an update: every CHANGELOG.md section since the version seen last (D66, D67, D98). A plain
 * list, or a step-by-step tour when any item has a screenshot (bundled in public/whats-new/, so it works offline).
 */
export function WhatsNew() {
  const version = useAppVersion();
  const [notes, setNotes] = useState<{ version: string; body: string }[] | null>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (version) setNotes(takeWhatsNew(version));
  }, [version]);
  const items = useMemo(() => (notes ?? []).flatMap((s) => newsItems(s.body).map((i) => ({ ...i, version: s.version }))), [notes]);
  if (!notes || !version) return null;

  const close = () => setNotes(null);
  const tour = items.some((i) => i.image);
  const item = items[step];
  const last = step === items.length - 1;
  const many = notes.length > 1;
  const title = many ? `${notes.length} updates you missed` : `What's new in Momentum ${version}`;

  return (
    <Dialog label={title} onClose={close} modal width={tour ? "max-w-2xl" : "max-w-lg"}>
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
            <Sparkles size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            {(tour || many) && <p className="text-xs text-muted">{[tour && `${step + 1} of ${items.length}`, many && `v${tour && item ? item.version : version}`].filter(Boolean).join(" · ")}</p>}
          </div>
        </div>

        {tour && item ? (
          <div key={step} className="anim-rise space-y-4">
            {item.image && <img src={item.image.src} alt={item.image.alt} className="max-h-[45vh] w-full rounded-card border border-border object-contain" />}
            <div className="prose-md text-sm text-fg-2">
              <ReactMarkdown>{item.text}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <ul className="max-h-[55vh] space-y-2.5 overflow-y-auto">
            {items.map((i, n) => (
              <li key={n} data-version={i.version} className="anim-rise flex gap-3 text-sm text-fg-2" style={{ animationDelay: `${n * 40}ms` }}>
                <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <div className="prose-md">
                  {many && items[n - 1]?.version !== i.version && <p className="!mb-1 text-xs font-semibold text-muted">v{i.version}</p>}
                  <ReactMarkdown>{i.text}</ReactMarkdown>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {tour && (
            <div className="mr-auto flex gap-1.5" aria-hidden>
              {items.map((_, n) => (
                <span key={n} className={`size-1.5 rounded-full transition-colors duration-[var(--dur)] ${n === step ? "bg-accent" : "bg-border"}`} />
              ))}
            </div>
          )}
          {tour && step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {tour && !last ? (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={close}>
              Let's go
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
