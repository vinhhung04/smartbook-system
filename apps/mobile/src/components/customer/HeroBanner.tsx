import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { getCategoryGradient } from '../../lib/posterArt';
import { colors, fonts, radius, shadow, spacing, typography } from '../../theme/customerTokens';
import { PosterCard } from './PosterCard';

type Props = {
  title: string;
  author: string | null;
  category: string | null;
  coverImageUrl: string | null;
  onPress: () => void;
};

const BANNER_HEIGHT = 340;

/**
 * The home tab's featured pick — full-bleed backdrop (blurred photo or the
 * same category gradient PosterCard uses) with a real PosterCard as
 * foreground so the featured book still looks like it belongs to the same
 * poster system as the shelves below it.
 */
export function HeroBanner({ title, author, category, coverImageUrl, onPress }: Props) {
  const [gradientStart, gradientEnd] = getCategoryGradient(category);

  return (
    <View style={styles.container}>
      {coverImageUrl ? (
        <Image source={{ uri: coverImageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={30} />
      ) : (
        <LinearGradient
          colors={[gradientStart, gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', colors.bg]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.content}>
        <View style={[styles.posterWrap, shadow.glow]}>
          <PosterCard
            title={title}
            category={category}
            coverImageUrl={coverImageUrl}
            width={150}
            height={225}
            onPress={onPress}
          />
        </View>

        <View style={styles.info}>
          <Text style={styles.eyebrow}>NỔI BẬT</Text>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {author ? (
            <Text style={styles.caption} numberOfLines={1}>
              {author}
            </Text>
          ) : null}

          <Pressable style={styles.cta} onPress={onPress}>
            <LinearGradient
              colors={[colors.accentGradientStart, colors.accentGradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.ctaGloss} />
            <Text style={styles.ctaText}>Xem chi tiết</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: BANNER_HEIGHT,
    justifyContent: 'flex-end',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  posterWrap: {
    borderRadius: radius.md,
  },
  info: {
    flex: 1,
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.label,
    color: colors.primary,
  },
  title: {
    ...typography.h1,
    fontSize: 26,
  },
  caption: {
    ...typography.caption,
  },
  cta: {
    marginTop: spacing.md,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  ctaGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderTopLeftRadius: radius.pill,
    borderTopRightRadius: radius.pill,
  },
  ctaText: {
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
    fontSize: 15,
  },
});
