import { Redirect } from "expo-router";
import { useEffect } from "react";
import { openQuickAdd } from "@/ui/QuickAdd";

/** `momentum://quickadd` (widgets, lock screen, Android shortcut): land on Today with the quick-add sheet open. */
export default function QuickAddLink() {
  useEffect(openQuickAdd, []);
  return <Redirect href="/" />;
}
