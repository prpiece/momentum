import { format } from "date-fns";
import { fromLocalDate } from "../../domain/dates";
import { TROPHIES } from "../../domain/perfect";
import type { ShareSummary } from "../../domain/shareCard";
import { LEVEL_LOOKS } from "../celebrate/trophyLooks";

export const CARD_W = 1200;
export const CARD_H = 630;

/** Draws the share card straight from the aggregates, in the current theme and accent. Numbers only (D93). */
export function drawShareCard(canvas: HTMLCanvasElement, s: ShareSummary) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const css = getComputedStyle(document.documentElement);
  const c = (name: string) => css.getPropertyValue(name).trim();
  const sans = c("--font-ui");
  const head = c("--font-head");
  const [bg, surface, fg, fg2, muted, border, accent] = ["--bg", "--raised", "--fg", "--fg-2", "--muted", "--border", "--accent"].map(c);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = surface;
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(24, 24, CARD_W - 48, CARD_H - 48, 28);
  ctx.fill();
  ctx.stroke();

  const text = (t: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left") => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t, x, y);
  };

  // Header: wordmark and period.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(76, 82, 11, 0, Math.PI * 2);
  ctx.fill();
  text("Momentum", 98, 91, `700 28px ${sans}`, fg);
  const last = fromLocalDate(s.bars[s.bars.length - 1].start);
  text(`${s.period === "week" ? "This week" : "Last 30 days"}  ·  ${format(fromLocalDate(s.from), "MMM d")} – ${format(last, "MMM d")}`, CARD_W - 76, 91, `600 24px ${sans}`, fg2, "right");

  // Four numbers.
  const hours = s.focusHours >= 10 ? Math.round(s.focusHours).toString() : s.focusHours.toFixed(1);
  const stats: [string, string][] = [
    [String(s.tasks), "tasks done"],
    [hours, "focus hours"],
    [String(s.streak), "day streak"],
    [String(s.perfectDays), "perfect days"],
  ];
  stats.forEach(([value, label], i) => {
    const x = 76 + (i % 2) * 300;
    const y = 190 + Math.floor(i / 2) * 120;
    text(value, x, y, `600 64px ${head}`, i === 0 ? accent : fg);
    text(label, x, y + 36, `500 22px ${sans}`, muted);
  });

  // Top trophy.
  const trophy = s.top ? TROPHIES.find((t) => t.id === s.top?.id) : null;
  if (s.top && trophy) {
    const look = LEVEL_LOOKS[s.top.level - 1];
    const size = 150;
    const x = 900;
    const y = 120;
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, look.from);
    if (look.mid) g.addColorStop(0.5, look.mid);
    g.addColorStop(1, look.to);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 48, size / 48);
    const path = new Path2D(look.path);
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.strokeStyle = "rgb(255 255 255 / 0.55)";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.restore();
    text(look.name, x + size / 2, y + size + 42, `700 28px ${sans}`, fg, "center");
    text(trophy.name, x + size / 2, y + size + 74, `500 21px ${sans}`, muted, "center");
  }

  // Bar strip.
  const top = 400;
  const base = 556;
  const left = 76;
  const width = CARD_W - 152;
  const max = Math.max(1, ...s.bars.map((b) => b.value));
  const slot = width / s.bars.length;
  const bw = Math.min(56, slot * 0.68);
  s.bars.forEach((b, i) => {
    const h = b.value ? Math.max(8, ((base - top) * b.value) / max) : 5;
    ctx.fillStyle = b.value ? accent : border;
    ctx.beginPath();
    ctx.roundRect(left + i * slot + (slot - bw) / 2, base - h, bw, h, Math.min(8, bw / 2));
    ctx.fill();
    const label = s.period === "week" ? format(fromLocalDate(b.start), "EEE") : i === 0 || i === s.bars.length - 1 ? format(fromLocalDate(b.start), "MMM d") : "";
    text(label, left + i * slot + slot / 2, base + 34, `500 20px ${sans}`, muted, i === 0 && s.period === "month" ? "left" : i === s.bars.length - 1 && s.period === "month" ? "right" : "center");
  });
}

/** The card as a PNG, after making sure the bundled fonts are loaded into the canvas. */
export async function renderShareCard(canvas: HTMLCanvasElement, s: ShareSummary): Promise<Blob | null> {
  const css = getComputedStyle(document.documentElement);
  await Promise.all([css.getPropertyValue("--font-ui"), css.getPropertyValue("--font-head")].flatMap((f) => [400, 600, 700].map((w) => document.fonts.load(`${w} 24px ${f}`).catch(() => []))));
  drawShareCard(canvas, s);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
