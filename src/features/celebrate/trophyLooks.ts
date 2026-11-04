/** One look per trophy level (D86): its own material and badge shape, drawn in a 48×48 SVG box. */

const poly = (n: number, outer: number, inner: number, rot = -90) =>
  Array.from({ length: n * (inner === outer ? 1 : 2) }, (_, i) => {
    const step = inner === outer ? 1 : 2;
    const r = i % 2 && step === 2 ? inner : outer;
    const a = ((rot + (i * 360) / (n * step)) * Math.PI) / 180;
    return `${(24 + r * Math.cos(a)).toFixed(2)},${(24 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

const pts = (p: string) => `M${p.split(" ").join(" L")} Z`;

export type LevelLook = { name: string; from: string; mid?: string; to: string; ink: string; path: string };

export const LEVEL_LOOKS: readonly LevelLook[] = [
  { name: "Bronze", from: "#e7a46b", to: "#9a5a2c", ink: "#fff", path: "M24 4 a20 20 0 1 0 0.01 0 Z" },
  { name: "Silver", from: "#f1f4f8", to: "#8e98a8", ink: "#3b4250", path: "M24 3 L42 9 V22 C42 34 34 41 24 45 C14 41 6 34 6 22 V9 Z" },
  { name: "Gold", from: "#ffe08a", to: "#d99a0b", ink: "#fff", path: pts(poly(5, 22, 11)) },
  { name: "Emerald", from: "#6ee7a8", to: "#0f7a4d", ink: "#fff", path: pts(poly(6, 21, 21)) },
  { name: "Sapphire", from: "#8fb8ff", to: "#1e40af", ink: "#fff", path: "M14 5 H34 L44 18 L24 45 L4 18 Z" },
  { name: "Amethyst", from: "#d6b4ff", to: "#6d28d9", ink: "#fff", path: "M5 15 L15 23 L24 6 L33 23 L43 15 L39 42 H9 Z" },
  { name: "Ruby", from: "#ff9a9a", to: "#b4123a", ink: "#fff", path: "M24 3 C30 12 40 18 40 30 C40 39 33 45 24 45 C15 45 8 39 8 30 C8 22 14 18 16 11 C19 17 22 17 24 3 Z" },
  { name: "Prism", from: "#7dd3fc", mid: "#fde68a", to: "#e879f9", ink: "#fff", path: pts(poly(12, 23, 17)) },
];
