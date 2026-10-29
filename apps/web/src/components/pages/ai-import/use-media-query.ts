import { useSyncExternalStore } from "react";

/** Two-panel review needs room: below this the form and the review rail become tabs. */
export const WIDE_WORKSPACE_QUERY = "(min-width: 1280px)";

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      window.addEventListener("resize", onChange);
      return () => {
        media.removeEventListener("change", onChange);
        window.removeEventListener("resize", onChange);
      };
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}
