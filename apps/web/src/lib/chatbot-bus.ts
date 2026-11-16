// Lets a page hand a question to the floating <AIChatbot/> (mounted in layout.tsx)
// without prop-drilling. By default the chatbot opens with the text in its
// input and the user decides whether to send it; `send: true` asks at once,
// for buttons whose label already is the question.
export interface ChatbotAskOptions {
  send?: boolean;
}

const bus = new EventTarget();
let listenerCount = 0;

/** Returns false when no chatbot is mounted, so the caller can fall back. */
export function askChatbot(prompt: string, options: ChatbotAskOptions = {}): boolean {
  if (listenerCount === 0) return false;
  bus.dispatchEvent(new CustomEvent<{ prompt: string; send: boolean }>("ask", { detail: { prompt, send: !!options.send } }));
  return true;
}

export function onChatbotAsk(handler: (prompt: string, options: { send: boolean }) => void) {
  const listener = (event: Event) => {
    const { prompt, send } = (event as CustomEvent<{ prompt: string; send: boolean }>).detail;
    handler(prompt, { send });
  };
  bus.addEventListener("ask", listener);
  listenerCount += 1;
  return () => {
    bus.removeEventListener("ask", listener);
    listenerCount -= 1;
  };
}
