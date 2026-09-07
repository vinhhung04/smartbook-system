import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';

import { getCategoryGradient, getMonogramLetter } from '../../lib/posterArt';
import { colors, fonts, radius, spacing } from '../../theme/customerTokens';

type Props = {
  title: string;
  category: string | null;
  coverImageUrl: string | null;
  width?: number;
  height?: number;
  onPress: () => void;
};

/**
 * The customer app's signature visual: a 2:3 "book jacket" — the authentic
 * shape of a real book cover, and close enough to a movie-poster ratio to
 * still read as "browse a shelf of posters". Most seeded books have no real
 * cover photo, so the generated branch (gradient by category + an oversized
 * bleeding monogram of the title's first letter) is the primary system, not
 * a rare fallback — both branches share the same bottom scrim + title
 * treatment so they read as one consistent poster system.
 */
export function PosterCard({ title, category, coverImageUrl, width = 120, height = 180, onPress }: Props) {
  const [pressed, setPressed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(coverImageUrl) && !imageFailed;
  const [gradientStart, gradientEnd] = getCategoryGradient(category);

  return (
    <MotiView animate={{ scale: pressed ? 0.96 : 1 }} transition={{ type: 'timing', duration: 120 }}>
      <Pressable
        style={[styles.card, { width, height }]}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
      >
        {showImage ? (
          <Image
            source={{ uri: coverImageUrl! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <>
            <LinearGradient
              colors={[gradientStart, gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text
              style={[
                styles.monogram,
                { fontSize: height * 0.85, color: gradientStart, lineHeight: height * 0.85 },
              ]}
            >
              {getMonogramLetter(title)}
            </Text>
          </>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.78)']}
          style={[styles.scrim, { height: height * 0.55 }]}
        />
        <Text style={[styles.title, { fontSize: Math.max(11, Math.round(height * 0.09)) }]} numberOfLines={3}>
          {title}
        </Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  monogram: {
    position: 'absolute',
    top: -12,
    left: -10,
    fontFamily: fonts.displayBold,
    opacity: 0.22,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  title: {
    fontFamily: fonts.displayBold,
    color: colors.textPrimary,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
