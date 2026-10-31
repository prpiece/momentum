import {
  Apple,
  Bed,
  Bike,
  BookOpen,
  Brain,
  Briefcase,
  Brush,
  CalendarDays,
  Cake,
  Camera,
  CigaretteOff,
  CircleCheck,
  Code,
  Coffee,
  CookingPot,
  Droplet,
  Dumbbell,
  FlaskConical,
  Flag,
  Flame,
  Flower2,
  Folder,
  Footprints,
  Gamepad2,
  Gem,
  GraduationCap,
  Guitar,
  Heart,
  Hourglass,
  House,
  Inbox,
  Languages,
  Leaf,
  Lightbulb,
  type LucideIcon,
  Moon,
  Mountain,
  Music,
  NotebookPen,
  Palette,
  PartyPopper,
  PawPrint,
  PenLine,
  PhoneOff,
  Pill,
  Plane,
  Rocket,
  Salad,
  ShoppingCart,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Target,
  Timer,
  TreePalm,
  TreePine,
  Trophy,
  Users,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";

/** The icons lists, habits and countdowns can use. Stored by key. */
export const ICONS: Record<string, LucideIcon> = {
  check: CircleCheck,
  target: Target,
  star: Star,
  flame: Flame,
  zap: Zap,
  trophy: Trophy,
  droplet: Droplet,
  salad: Salad,
  apple: Apple,
  coffee: Coffee,
  pill: Pill,
  sleep: Bed,
  moon: Moon,
  sun: Sun,
  meditate: Flower2,
  brain: Brain,
  heart: Heart,
  run: Footprints,
  bike: Bike,
  strength: Dumbbell,
  mountain: Mountain,
  leaf: Leaf,
  sprout: Sprout,
  book: BookOpen,
  pen: PenLine,
  notebook: NotebookPen,
  school: GraduationCap,
  lab: FlaskConical,
  languages: Languages,
  code: Code,
  idea: Lightbulb,
  work: Briefcase,
  home: House,
  inbox: Inbox,
  folder: Folder,
  cart: ShoppingCart,
  wallet: Wallet,
  tools: Wrench,
  clean: Brush,
  cook: CookingPot,
  pet: PawPrint,
  people: Users,
  music: Music,
  guitar: Guitar,
  art: Palette,
  camera: Camera,
  game: Gamepad2,
  sparkles: Sparkles,
  "phone-off": PhoneOff,
  "no-smoking": CigaretteOff,
  timer: Timer,
  hourglass: Hourglass,
  calendar: CalendarDays,
  cake: Cake,
  party: PartyPopper,
  plane: Plane,
  beach: TreePalm,
  tree: TreePine,
  gem: Gem,
  rocket: Rocket,
  flag: Flag,
};

/** Emoji from before icons existed, mapped to the closest icon. */
const LEGACY: Record<string, string> = {
  "✅": "check", "💧": "droplet", "🧘": "meditate", "🏃": "run", "📚": "book", "💪": "strength", "🥗": "salad", "😴": "sleep",
  "🚶": "run", "🦷": "sparkles", "📵": "phone-off", "✍️": "pen", "🎸": "guitar", "🧹": "clean", "💊": "pill", "🌞": "sun",
  "🙏": "heart", "💰": "wallet", "🧠": "brain", "🚴": "bike", "📥": "inbox", "💼": "work", "🏠": "home", "🎓": "school",
  "🛒": "cart", "✈️": "plane", "💡": "idea", "🎯": "target", "🧪": "lab", "🎨": "art", "🎵": "music", "🌱": "sprout",
  "❤️": "heart", "🍳": "cook", "🐾": "pet", "🛠️": "tools", "📝": "notebook", "🚀": "rocket", "⭐": "star", "🗓️": "calendar",
  "⏳": "hourglass", "🎂": "cake", "💍": "gem", "🎄": "tree", "🏖️": "beach", "🚭": "no-smoking", "🏁": "flag", "📅": "calendar", "🎉": "party",
};

export const iconOf = (key: string | null | undefined): LucideIcon | null => (key ? (ICONS[key] ?? ICONS[LEGACY[key] ?? ""] ?? null) : null);

/** Renders a stored icon key (or legacy emoji); unknown values fall back to `fallback`. */
export function AppIcon({ name, size = 16, fallback = CircleCheck, className, color }: { name: string | null | undefined; size?: number; fallback?: LucideIcon; className?: string; color?: string }) {
  const I = iconOf(name) ?? fallback;
  return <I size={size} strokeWidth={2} className={className} style={color ? { color } : undefined} aria-hidden="true" />;
}

/** A tinted rounded tile with the icon, used for habits and countdowns. */
export function IconTile({ name, color, size = 36, fallback }: { name: string; color: string; size?: number; fallback?: LucideIcon }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-md" style={{ width: size, height: size, background: `color-mix(in oklch, ${color} 16%, transparent)` }}>
      <AppIcon name={name} size={Math.round(size * 0.5)} color={color} fallback={fallback} />
    </span>
  );
}

export function IconPicker({ value, onChange, color, none }: { value: string | null; onChange: (key: string | null) => void; color?: string; none?: string }) {
  const current = iconOf(value);
  return (
    // Padding inside the scroller keeps the selected ring from being clipped at its edges.
    <div className="scroll-thin grid max-h-40 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] justify-items-center gap-1 overflow-y-auto p-1" role="group" aria-label="Icon">
      {none && (
        <button type="button" onClick={() => onChange(null)} aria-pressed={value === null} className={`grid size-9 place-items-center rounded-sm text-[0.65rem] text-muted transition-colors ${value === null ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-hover"}`}>
          {none}
        </button>
      )}
      {Object.entries(ICONS).map(([key, I]) => {
        const on = current === I;
        return (
          <button key={key} type="button" title={key} aria-label={key} aria-pressed={on} onClick={() => onChange(key)} className={`grid size-9 place-items-center rounded-sm transition-colors ${on ? "bg-accent-soft ring-1 ring-accent" : "text-fg-2 hover:bg-hover hover:text-fg"}`}>
            <I size={17} style={on && color ? { color } : undefined} />
          </button>
        );
      })}
    </div>
  );
}

/** A list's icon in its color, or a color dot when it has no icon. */
export function ListGlyph({ icon, color, size = 15 }: { icon: string | null; color: string | null; size?: number }) {
  if (!iconOf(icon)) return <span className="shrink-0 rounded-full" style={{ width: size * 0.6, height: size * 0.6, background: color ?? "var(--fg-muted)" }} />;
  return <AppIcon name={icon} size={size} color={color ?? undefined} className={color ? undefined : "text-muted"} />;
}
