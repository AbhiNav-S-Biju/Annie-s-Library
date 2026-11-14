// Overlays (sheet, reader) participate in browser history so the phone's Back button closes them.
const stack = [];

window.addEventListener('popstate', () => {
  const top = stack.pop();
  if (top) top.close();
});

/** Register an overlay. Returns a function that closes it (through history, so Back stays in sync). */
export function pushOverlay(close) {
  const entry = { close, done: false };
  const wrapped = () => {
    if (entry.done) return;
    entry.done = true;
    close();
  };
  entry.close = wrapped;
  stack.push(entry);
  try { history.pushState({ overlay: stack.length }, ''); } catch { /* ignore */ }
  return () => {
    if (entry.done) return;
    if (stack[stack.length - 1] === entry) {
      history.back(); // popstate will call wrapped()
    } else {
      // Not on top (rare): close directly and drop it from the stack.
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      wrapped();
    }
  };
}
