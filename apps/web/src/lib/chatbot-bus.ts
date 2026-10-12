// Lets a page hand a question to the floating <AIChatbot/> (mounted in layout.tsx)
// without prop-drilling. The chatbot opens with the text in its input; the user
// still decides whether to send it.
const bus = new EventTarget();
let listenerCount = 0;

/** Returns false when no chatbot is mounted, so the caller can fall back. */
export function askChatbot(prompt: string): boolean {
  if (listenerCount === 0) return false;
  bus.dispatchEvent(new CustomEvent<string>("ask", { detail: prompt }));
  return true;
}

export function onChatbotAsk(handler: (prompt: string) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail);
  bus.addEventListener("ask", listener);
  listenerCount += 1;
  return () => {
    bus.removeEventListener("ask", listener);
    listenerCount -= 1;
  };
}
