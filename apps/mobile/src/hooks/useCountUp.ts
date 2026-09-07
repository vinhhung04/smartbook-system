import { useEffect, useState } from 'react';
import { useAnimatedReaction, useSharedValue, runOnJS, withTiming } from 'react-native-reanimated';

/** Animates a displayed number from its previous value up to `target`. */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(target, { duration: durationMs });
  }, [target, durationMs, progress]);

  useAnimatedReaction(
    () => Math.round(progress.value),
    (current, previous) => {
      if (current !== previous) {
        runOnJS(setValue)(current);
      }
    },
    [],
  );

  return value;
}
