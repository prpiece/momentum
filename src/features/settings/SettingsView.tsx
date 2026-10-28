import { Check } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Segmented } from "../../components/ui/Segmented";
import { AboutSection, DataSection } from "./DataSection";
import { NotificationSection } from "./NotificationSection";
import { TagsSection } from "./TagsSection";
import { openWelcome } from "../shell/Welcome";
import { ACCENT_PRESETS } from "../../domain/color";
import type { Settings, ViewId } from "../../domain/types";
import { saveWorkspace } from "../../db/repo";
import { hydrate } from "../../stores/data";
import { hydrateCountdowns, saveCountdowns } from "../../stores/countdowns";
import { hydrateFocus, saveSessions } from "../../stores/focus";
import { hydrateHabits, saveHabitData } from "../../stores/habits";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/ui";
import { MODULE_NAV, SMART_LIST_NAV } from "../shell/nav";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface-2 p-5 shadow-sm">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
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

function AccentPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const swatch = "grid size-7 place-items-center rounded-full transition-transform duration-[var(--dur)] hover:scale-110";
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Accent color">
      {ACCENT_PRESETS.map((p) => (
        <button
          key={p.hex}
          type="button"
          title={p.name}
          aria-label={p.name}
          aria-pressed={p.hex === value}
          onClick={() => onChange(p.hex)}
          className={swatch}
          style={{ background: p.hex }}
        >
          {p.hex === value && <Check size={15} strokeWidth={3} className="text-accent-fg" />}
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
      className={`h-9 min-w-40 rounded-sm border px-3 font-mono text-sm ${recording ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}
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
        <Row label="Font size">
          <Segmented
            name="fontSize"
            label="Font size"
            value={s.fontSize}
            onChange={set("fontSize")}
            options={[
              { value: "sm", label: "Small" },
              { value: "md", label: "Default" },
              { value: "lg", label: "Large" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Layout">
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
        <Row label="Start view">
          <select
            value={s.defaultView}
            onChange={(e) => {
              const v = DEFAULT_VIEWS.find((d) => d.id === e.target.value);
              if (v) update({ defaultView: v.id });
            }}
            className="h-9 rounded-sm border border-border bg-surface px-3 text-sm"
          >
            {DEFAULT_VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Date & time">
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
      </Section>

      <Section title="Tasks">
        <Row label="Smart parsing in quick add">
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={s.smartParse} onChange={(e) => update({ smartParse: e.target.checked })} />
            Detect dates, !priority, #tags, ~lists
          </label>
        </Row>
      </Section>

      <Section title="Tags">
        <TagsSection />
      </Section>

      <Section title="Notifications">
        <NotificationSection />
      </Section>

      <Section title="System">
        <Row label="Closing the window">
          <Toggle checked={s.closeToTray} onChange={(v) => update({ closeToTray: v })} text="Keep running in the tray" />
        </Row>
        <Row label="Launch at login">
          <Toggle checked={s.launchAtStartup} onChange={(v) => update({ launchAtStartup: v })} text="Start minimized to the tray" />
        </Row>
        <Row label="Welcome tour">
          <button type="button" onClick={openWelcome} className="h-9 rounded-sm border border-border px-3 text-sm hover:bg-hover">
            Show the tour again
          </button>
        </Row>
        <Row label="Global quick add">
          <ShortcutInput value={s.quickAddShortcut} onChange={(v) => update({ quickAddShortcut: v })} />
        </Row>
      </Section>


      <Section title="Data">
        <DataSection />
      </Section>

      <Section title="About">
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
                await saveCountdowns(seed.sampleCountdowns());
                await saveSessions(seed.sampleFocus(ws.tasks));
                await Promise.all([hydrate(), hydrateHabits(), hydrateCountdowns(), hydrateFocus()]);
                toast("Sample data loaded");
              }}
              className="h-9 rounded-sm border border-border px-3 text-sm hover:bg-hover"
            >
              Load sample data
            </button>
          </Row>
        </Section>
      )}
    </div>
  );
}
