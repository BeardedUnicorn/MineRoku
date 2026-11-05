// The splash itself lives in index.html so it can paint before the JS bundle loads.

// Measured from navigation start, so fast loads don't flash the splash.
const MIN_VISIBLE_MS = 400;
// Slightly longer than the CSS fade; transitionend never fires with reduced motion.
const REMOVE_FALLBACK_MS = 320;

export const dismissSplash = (): void => {
  const splash = document.getElementById('app-splash');
  if (!splash || splash.dataset.state) {
    return;
  }
  splash.dataset.state = 'waiting';

  window.setTimeout(() => {
    splash.dataset.state = 'leaving';
    const remove = () => splash.remove();
    splash.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, REMOVE_FALLBACK_MS);
  }, Math.max(0, MIN_VISIBLE_MS - performance.now()));
};
