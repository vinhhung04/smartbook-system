// Keeps the header bell and the /customer/notifications page on the same
// unread count. They are unrelated siblings in the layout, so — like
// command-palette-bus.ts — they talk through a tiny in-memory event target.
// Whoever learns the authoritative count (a server response) publishes it.
const bus = new EventTarget();

export function publishUnreadCount(count: number) {
  bus.dispatchEvent(new CustomEvent<number>('unread-count', { detail: Math.max(0, count) }));
}

export function onUnreadCount(handler: (count: number) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<number>).detail);
  bus.addEventListener('unread-count', listener);
  return () => bus.removeEventListener('unread-count', listener);
}
