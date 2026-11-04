/** Preset gradients for the app background (D79). Mid-tone so the theme-following dim keeps text readable in both themes. */
export const GRADIENTS = [
  { id: "dusk", name: "Dusk", css: "linear-gradient(135deg, #3b3f8f 0%, #8a4fa8 55%, #e0728f 100%)" },
  { id: "ocean", name: "Ocean", css: "linear-gradient(160deg, #0f5a8a 0%, #1c8fa6 55%, #5fd0c0 100%)" },
  { id: "forest", name: "Forest", css: "linear-gradient(150deg, #1d5a3c 0%, #3f8a55 55%, #a3c46a 100%)" },
  { id: "ember", name: "Ember", css: "linear-gradient(135deg, #8f2d3a 0%, #d2573b 55%, #f2a65a 100%)" },
  { id: "aurora", name: "Aurora", css: "radial-gradient(120% 90% at 20% 10%, #3fbf9f 0%, transparent 55%), linear-gradient(160deg, #2a2f7a 0%, #5a3c9a 100%)" },
  { id: "sand", name: "Sand", css: "linear-gradient(145deg, #b88a5c 0%, #d9b98a 55%, #efd9b4 100%)" },
  { id: "slate", name: "Slate", css: "linear-gradient(160deg, #2f3a4a 0%, #52647a 55%, #8296ad 100%)" },
  { id: "blossom", name: "Blossom", css: "linear-gradient(135deg, #a8467a 0%, #d779a0 55%, #f3b6c0 100%)" },
] as const;

export type GradientId = (typeof GRADIENTS)[number]["id"];

export const gradientCss = (id: GradientId) => GRADIENTS.find((g) => g.id === id)?.css ?? "none";

export const DIM_MAX = 80;
export const BLUR_MAX = 20;
