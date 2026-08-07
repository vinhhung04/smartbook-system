import { useEffect } from "react";

// Keyboard-wedge USB/Bluetooth barcode scanners "type" a code very fast (a few ms
// between keystrokes) and terminate with Enter — much faster than a human typing.
const SCANNER_KEY_GAP_MS = 100;
const SCANNER_MIN_CODE_LENGTH = 3;

/**
 * Listens for hardware keyboard-wedge scanner input anywhere on the page (not tied to any
 * single input field). Ignores keystrokes while a text input/textarea is focused so normal
 * typing isn't mistaken for a scan.
 */
export function useHardwareScanner(onScan: (code: string) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastKeyTime = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

      const now = Date.now();
      if (now - lastKeyTime > SCANNER_KEY_GAP_MS) {
        buffer = "";
      }
      lastKeyTime = now;

      if (event.key === "Enter") {
        if (buffer.length >= SCANNER_MIN_CODE_LENGTH) {
          onScan(buffer);
        }
        buffer = "";
        return;
      }

      if (event.key.length === 1) {
        buffer += event.key;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onScan, enabled]);
}
