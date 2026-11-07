import { Bell, Database, Info, LifeBuoy, type LucideIcon, Mic, Palette, Settings2, Wrench } from "lucide-react";
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { Switch } from "../../components/ui/Switch";
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

/** A settings group (D198): a small label over one bordered card; each direct child is a row with a hairline above it. */
function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section id={id} data-settings-section className="scroll-mt-8">
      <h2 className="t-label mb-1.5 ml-0.5 text-muted">{title}</h2>
      <div className="overflow-hidden rounded-card border border-border bg-surface [&>*]:px-3.5 [&>*]:py-3 [&>*+*]:border-t [&>*+*]:border-border">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  );
}

function AccentPicker({ value, onChange }: { value: AccentId; onChange: (id: AccentId) => void }) {
  const swatch = "size-[22px] rounded-full swatch";
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
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <span className="flex items-center gap-2.5 text-[length:var(--fs-sm)] text-muted">
      {text}
      <Switch checked={checked} onChange={onChange} label={text} />
    </span>
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
      className={`btn min-w-40 tabular-nums ${recording ? "border-accent-text bg-accent-soft text-fg" : "btn-secondary"}`}
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

  const sections = SECTIONS.filter((x) => x.id !== "settings-developer" || import.meta.env.DEV);
  const pane = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(sections[0].id);
  // The nav marks the last group whose top has scrolled past the top of the pane.
  const onScroll = () => {
    const root = pane.current;
    if (!root) return;
    const edge = root.getBoundingClientRect().top + 40;
    const passed = [...root.querySelectorAll<HTMLElement>("[data-settings-section]")].filter((el) => el.getBoundingClientRect().top <= edge);
    setCurrent(passed[passed.length - 1]?.id ?? sections[0].id);
  };

  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Settings sections" className="hidden w-[var(--side-panel)] shrink-0 flex-col gap-px border-r border-border px-2 py-4 md:flex">
        {sections.map((x) => (
          <button key={x.id} type="button" aria-current={current === x.id ? "true" : undefined} onClick={() => (document.getElementById(x.id)?.scrollIntoView({ block: "start" }), setCurrent(x.id))} className="nav-item w-full">
            <span className="ni-icon">
              <x.icon size={16} strokeWidth={1.75} />
            </span>
            <span className="ni-label">{x.title}</span>
          </button>
        ))}
      </nav>
      <div ref={pane} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
    <div className="flex max-w-[640px] flex-col gap-6 px-6 py-8 md:px-12">
      <Section title="General" id="settings-general">
        <Row label="Start view">
          <select
            value={s.defaultView}
            onChange={(e) => {
              const v = DEFAULT_VIEWS.find((d) => d.id === e.target.value);
              if (v) update({ defaultView: v.id });
            }}
            className="input w-auto"
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
          <Toggle checked={s.smartParse} onChange={(v) => update({ smartParse: v })} text="Detect dates, !priority, #tags, ~lists" />
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
          <span className="font-medium">Tags</span>
          <TagsSection />
        </div>
      </Section>

      <Section title="Appearance" id="settings-appearance">
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
            <span className="text-[length:var(--fs-xs)] text-muted">Ctrl + / Ctrl − / Ctrl 0</span>
            <Segmented name="zoom" label="Zoom" value={s.zoom} onChange={set("zoom")} options={ZOOMS.map((z) => ({ value: z, label: `${Math.round(z * 100)}%` }))} />
          </div>
        </Row>
      </Section>

      <Section title="Notifications & sounds" id="settings-notifications">
        <NotificationSection />
        <SoundsSection />
      </Section>

      <Section title="Voice" id={VOICE_SECTION_ID}>
        <VoiceSection />
        <Row label="Push to talk">
          <ShortcutInput value={s.voiceShortcut} onChange={(v) => (v === s.quickAddShortcut ? toast("That shortcut already opens quick add.") : update({ voiceShortcut: v }))} />
        </Row>
        <p className="text-[length:var(--fs-sm)] text-muted">Hold the shortcut, say a task, let go, then press Enter. Or say “start focus”, “stop focus”, “open today”, “show matrix”, “show completed” or “open calendar”.</p>
      </Section>

      <Section title="Data" id="settings-data">
        <DataSection />
      </Section>

      <Section title="Help" id={HELP_SECTION_ID}>
        <HelpSection />
      </Section>

      <Section title="About & updates" id="settings-about">
        <UpdatesSection />
        <AboutSection />
      </Section>

      {import.meta.env.DEV && (
        <Section title="Developer" id="settings-developer">
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
              className="btn btn-secondary"
            >
              Load sample data
            </button>
          </Row>
        </Section>
      )}
    </div>
      </div>
    </div>
  );
}

const SECTIONS: { id: string; title: string; icon: LucideIcon }[] = [
  { id: "settings-general", title: "General", icon: Settings2 },
  { id: "settings-appearance", title: "Appearance", icon: Palette },
  { id: "settings-notifications", title: "Notifications & sounds", icon: Bell },
  { id: VOICE_SECTION_ID, title: "Voice", icon: Mic },
  { id: "settings-data", title: "Data", icon: Database },
  { id: HELP_SECTION_ID, title: "Help", icon: LifeBuoy },
  { id: "settings-about", title: "About & updates", icon: Info },
  { id: "settings-developer", title: "Developer", icon: Wrench },
];
