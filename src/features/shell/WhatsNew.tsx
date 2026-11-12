import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button, Dialog } from "../../components/ui/Dialog";
import { newsGroups, newsItems } from "../../domain/changelog";
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
  const title = many ? `Momentum ${notes[notes.length - 1].version} to ${notes[0].version}` : `Momentum ${version}`;

  return (
    <Dialog label={title} onClose={close} modal width={tour ? "max-w-2xl" : "max-w-lg"}>
      <div className="p-6">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {tour && <p className="mb-4 text-xs text-muted">{[`${step + 1} of ${items.length}`, many && item && `v${item.version}`].filter(Boolean).join(" · ")}</p>}

        {tour && item ? (
          <div key={step} className="anim-rise space-y-4">
            {item.image && <img src={item.image.src} alt={item.image.alt} className="max-h-[45vh] w-full rounded-card border border-border object-contain" />}
            <div className="prose-md text-sm text-fg-2">
              <ReactMarkdown>{item.text}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto text-sm text-fg-2">
            {notes.map((s) => (
              <section key={s.version} data-version={s.version}>
                {many && <h3 className="mb-1 text-sm font-semibold text-fg">v{s.version}</h3>}
                {newsGroups(s.body).map((g, n) => (
                  <div key={n} className="mb-2">
                    {g.heading && <h4 className="mb-1 text-xs font-semibold text-muted">{g.heading}</h4>}
                    <ul className="list-disc space-y-1.5 pl-5">
                      {g.items.map((i, m) => (
                        <li key={m} className="prose-md">
                          <ReactMarkdown>{i.text}</ReactMarkdown>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {tour && step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {tour && !last ? (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={close}>
              Close
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
