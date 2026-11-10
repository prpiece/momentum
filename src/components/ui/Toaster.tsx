import { Toaster as Sonner } from "sonner";
import { useSettings } from "../../stores/settings";

/**
 * Sonner (D207) for stacking, swipe-to-dismiss, hover pause and exit motion; unstyled, so the toast
 * keeps the app's own `.toast` look. Its transitions obey the global reduced-motion rule in tokens.css.
 */
export function Toaster() {
  const theme = useSettings((s) => s.settings.theme);
  return (
    <Sonner
      position="bottom-center"
      visibleToasts={3}
      gap={8}
      theme={theme}
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "layer layer-raised toast w-[min(420px,calc(100vw-32px))]",
          actionButton: "btn btn-ghost btn-sm toast-act shrink-0",
          closeButton: "btn btn-ghost btn-sm icon-btn order-last shrink-0 text-muted",
        },
      }}
    />
  );
}
