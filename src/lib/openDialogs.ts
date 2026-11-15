/** How many `Dialog`s are mounted. Global shortcuts and Ctrl/Cmd+Z stand down while any is open (H12). */
let open = 0;
/** Count a dialog in; returns the function that counts it out. */
export function trackDialog(): () => void {
  open++;
  let done = false;
  return () => {
    if (!done) open--;
    done = true;
  };
}
export const dialogOpen = () => open > 0;
