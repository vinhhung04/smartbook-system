import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

// Core GSAP for the whole app. Pages that also need ScrollTrigger import it from
// components/public/gsap-motion, so the login pages never load it.
gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };

/** Every GSAP scene runs only inside this query; reduced motion gets the final layout, untouched. */
export const MOTION_OK = '(prefers-reduced-motion: no-preference)';
/** Long exponential settle: fast start, soft landing. Shared so the site moves with one voice. */
export const EASE_OUT = 'expo.out';
