// Lets the topbar's visible search button and the <CommandPalette/> dialog talk to
// each other without prop-drilling `open` state through the app shell — they're
// mounted as unrelated siblings in layout.tsx.
const bus = new EventTarget();

export function openCommandPalette() {
  bus.dispatchEvent(new Event("open"));
}

export function onCommandPaletteOpen(handler: () => void) {
  bus.addEventListener("open", handler);
  return () => bus.removeEventListener("open", handler);
}
