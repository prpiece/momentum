let n = 0;
/** Freezes the app scroller (`[data-scroller]`, tokens.css) while a modal or the tour is open; nested locks stack. Returns the unlock. */
export function lockScroll() {
  if (++n === 1) document.documentElement.dataset.scrollLock = "";
  return () => {
    if (--n === 0) delete document.documentElement.dataset.scrollLock;
  };
}
