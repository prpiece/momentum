import { Check } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { Segmented } from "../../components/ui/Segmented";
import { AboutSection, DataSection } from "./DataSection";
import { NotificationSection } from "./NotificationSection";
import { SoundsSection } from "./SoundsSection";
import { UpdatesSection } from "./UpdatesSection";
import { VoiceSection } from "./VoiceSection";
import { VOICE_SECTION_ID } from "../../lib/voice";
import { TagsSection } from "./TagsSection";
import { HelpSection } from "../help/HelpSection";
import { HELP_SECTION_ID } from "../help/featureIcons";
import { LayoutPicker } from "./LayoutPicker";
import { ACCENTS, type AccentId } from "../../domain/color";
import { ZOOMS, type Settings, type ViewId } from "../../domain/types";
import { saveWorkspace } from "../../db/repo";
import { hydrate } from "../../stores/data";
import { hydrateFocus, saveSessions } from "../../stores/focus";
import { hydrateHabits, saveHabitData } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/ui";
import { MODULE_NAV, SMART_LIST_NAV } from "../shell/nav";

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 card p-5">
      <h2 className="mb-4 t-label text-muted">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function AccentPicker({ value, onChange }: { value: AccentId; onChange: (id: AccentId) => void }) {
  const swatch = `grid size-7 place-items-center rounded-full transition-transform duration-[var(--dur)] hover:scale-110 swatch`;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Accent color">
      {ACCENTS.map((p) => (
        <button
          key={p.id}
          type="button"
          title={p.name}
          aria-label={p.name}
          aria-pressed={p.id === value}
          onClick={() => onChange(p.id)}
          className={swatch}
          style={{ "--sw": p.light, "--sw-d": p.dark } as CSSProperties}
        >
          {p.id === value && <Check size={15} strokeWidth={3} className="text-accent-fg" />}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-fg-2">
      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {text}
    </label>
  );
}

/** Click, then press a combination (Ctrl/Alt plus a key) to record it. */
function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const label = value.replace("CommandOrControl", "Ctrl").split("+").join(" + ");
  return (
    <button
      type="button"
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        if (e.key === "Escape") return setRecording(false);
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
        const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
        onChange([e.ctrlKey || e.metaKey ? "CommandOrControl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : "", key].filter(Boolean).join("+"));
        setRecording(false);
      }}
      className={`h-9 min-w-40 rounded-control border px-3 tabular-nums text-sm ${recording ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}
    >
      {recording ? "Press keys…" : label}
    </button>
  );
}

const DEFAULT_VIEWS: { id: ViewId; label: string }[] = [...SMART_LIST_NAV, ...MODULE_NAV];

export function SettingsView() {
  const s = useSettings((st) => st.settings);
  const update = useSettings((st) => st.update);
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => update({ [key]: value });

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <Section title="General">
        <Row label="Start view">
          <select
            value={s.defaultView}
            onChange={(e) => {
              const v = DEFAULT_VIEWS.find((d) => d.id === e.target.value);
              if (v) update({ defaultView: v.id });
            }}
            className="h-9 rounded-control border border-border bg-surface px-3 text-sm"
          >
            {DEFAULT_VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Week starts on">
          <Segmented
            name="weekStart"
            label="Week starts on"
            value={s.weekStart}
            onChange={set("weekStart")}
            options={[
              { value: 1, label: "Monday" },
              { value: 0, label: "Sunday" },
              { value: 6, label: "Saturday" },
            ]}
          />
        </Row>
        <Row label="Time format">
          <Segmented
            name="timeFormat"
            label="Time format"
            value={s.timeFormat}
            onChange={set("timeFormat")}
            options={[
              { value: "12h", label: "1:30 PM" },
              { value: "24h", label: "13:30" },
            ]}
          />
        </Row>
        <Row label="Smart parsing in quick add">
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={s.smartParse} onChange={(e) => update({ smartParse: e.target.checked })} />
            Detect dates, !priority, #tags, ~lists
          </label>
        </Row>
        <Row label="Closing the window">
          <Toggle checked={s.closeToTray} onChange={(v) => update({ closeToTray: v })} text="Keep running in the tray" />
        </Row>
        <Row label="Launch at login">
          <Toggle checked={s.launchAtStartup} onChange={(v) => update({ launchAtStartup: v })} text="Start minimized to the tray" />
        </Row>
        <Row label="Global quick add">
          <ShortcutInput value={s.quickAddShortcut} onChange={(v) => (v === s.voiceShortcut ? toast("That shortcut is already push-to-talk.") : update({ quickAddShortcut: v }))} />
        </Row>
        <Row label="Mini window">
          <ShortcutInput value={s.miniShortcut} onChange={(v) => update({ miniShortcut: v })} />
        </Row>
        <div className="space-y-2">
          <span className="text-sm font-medium">Tags</span>
          <TagsSection />
        </div>
      </Section>

      <Section title="Appearance">
        <Row label="Theme">
          <Segmented
            name="theme"
            label="Theme"
            value={s.theme}
            onChange={set("theme")}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </Row>
        <Row label="Accent">
          <AccentPicker value={s.accent} onChange={set("accent")} />
        </Row>
        <LayoutPicker />
        {s.layout === "sidebar" && (
          <Row label="Sidebar position">
            <Segmented
              name="sidebarSide"
              label="Sidebar position"
              value={s.sidebarSide}
              onChange={set("sidebarSide")}
              options={[
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ]}
            />
          </Row>
        )}
        <Row label="Animations">
          <Segmented
            name="motion"
            label="Animations"
            value={s.motion}
            onChange={set("motion")}
            options={[
              { value: "system", label: "System" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
        </Row>
        <Row label="Density">
          <Segmented
            name="density"
            label="Density"
            value={s.density}
            onChange={set("density")}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </Row>
        <Row label="Text size">
          <Segmented
            name="fontSize"
            label="Text size"
            value={s.fontSize}
            onChange={set("fontSize")}
            options={[
              { value: "sm", label: "Small" },
              { value: "md", label: "Default" },
              { value: "lg", label: "Large" },
              { value: "xl", label: "Larger" },
              { value: "xxl", label: "Largest" },
            ]}
          />
        </Row>
        <Row label="Zoom">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">Ctrl + / Ctrl − / Ctrl 0</span>
            <Segmented name="zoom" label="Zoom" value={s.zoom} onChange={set("zoom")} options={ZOOMS.map((z) => ({ value: z, label: `${Math.round(z * 100)}%` }))} />
          </div>
        </Row>
      </Section>

      <Section title="Notifications & sounds">
        <NotificationSection />
        <SoundsSection />
      </Section>

      <Section title="Voice" id={VOICE_SECTION_ID}>
        <VoiceSection />
        <Row label="Push to talk">
          <ShortcutInput value={s.voiceShortcut} onChange={(v) => (v === s.quickAddShortcut ? toast("That shortcut already opens quick add.") : update({ voiceShortcut: v }))} />
        </Row>
        <p className="text-xs text-muted">Hold the shortcut, say a task, let go, then press Enter. Or say “start focus”, “stop focus”, “open today”, “show matrix”, “show completed” or “open calendar”.</p>
      </Section>

      <Section title="Data">
        <DataSection />
      </Section>

      <Section title="Help" id={HELP_SECTION_ID}>
        <HelpSection />
      </Section>

      <Section title="About & updates">
        <UpdatesSection />
        <AboutSection />
      </Section>

      {import.meta.env.DEV && (
        <Section title="Developer">
          <Row label="Sample data">
            <button
              type="button"
              onClick={async () => {
                const seed = await import("../../dev/seed");
                const ws = seed.sampleWorkspace();
                await saveWorkspace(ws);
                await saveHabitData(seed.sampleHabits());
                await saveSessions(seed.sampleFocus(ws.tasks));
                await Promise.all([hydrate(), hydrateHabits(), hydrateFocus()]);
                toast("Sample data loaded");
              }}
              className="h-9 rounded-control border border-border px-3 text-sm hover:bg-surface-2"
            >
              Load sample data
            </button>
          </Row>
        </Section>
      )}
    </div>
  );
}
