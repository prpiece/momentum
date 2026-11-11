/**
 * The toast the shared stores and sync call (PLAN D229). Each app plugs in its own: desktop shows
 * Sonner (stores/ui.ts), the phone its own. Until one is set, messages only go to the console.
 */
export type ToastAction = { label: string; run: () => void };
type Show = (message: string, action?: ToastAction, ms?: number) => void;

let show: Show = (message) => console.info(message);
export const setToast = (fn: Show) => void (show = fn);
export const toast: Show = (message, action, ms) => show(message, action, ms);
