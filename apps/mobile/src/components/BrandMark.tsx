import Svg, { Path } from 'react-native-svg';

import { brand } from '../design-system';

// Geometry from assets/branding (scripts/build_svgs.py); the same mark as the app icon.
const SYMBOL = 'M8.25 0H30V6.75H21.75V9.75H30V16.5H8.25A8.25 8.25 0 0 1 8.25 0ZM0 19.5H21.75A8.25 8.25 0 0 1 21.75 36H0V29.25H8.25V26.25H0Z';

type Props = {
  /** Height in dp; width follows the 30 x 36 artwork. */
  size?: number;
  color?: string;
};

/** The SmartBook symbol. Decorative: the caller's header carries the name. */
export function BrandMark({ size = 28, color = brand.lamp }: Props) {
  return (
    <Svg width={(size * 30) / 36} height={size} viewBox="0 0 30 36" accessible={false}>
      <Path d={SYMBOL} fill={color} />
    </Svg>
  );
}
