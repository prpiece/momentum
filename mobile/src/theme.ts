import { useColorScheme } from "react-native";

// ponytail: hand-copied from src/styles/tokens.css (default accent); ticket C5 generates these from the CSS.
const light = { bg: "#F6F5F2", surface: "#FDFCFA", surface2: "#F0EEEA", border: "#E5E2DC", fg: "#1F1D1A", fg2: "#4A4640", muted: "#6B665E", accent: "#5151CC", accentFg: "#FFFFFF" };
const dark: typeof light = { bg: "#141519", surface: "#1B1D22", surface2: "#24262C", border: "#2E3037", fg: "#ECEAE5", fg2: "#BEBBB5", muted: "#8F8D88", accent: "#9C9CF2", accentFg: "#141519" };

export type Colors = typeof light;
export const useColors = (): Colors => (useColorScheme() === "dark" ? dark : light);
