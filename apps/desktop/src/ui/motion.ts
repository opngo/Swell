/**
 * Motion presets (§3.4). Springs are deliberately tuned: `snappy` for controls
 * that must feel instant, `swell` for page-level moments.
 */

import type { Transition } from 'motion/react';

export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 },
  smooth: { type: 'spring', stiffness: 320, damping: 30, mass: 0.9 },
  swell: { type: 'spring', stiffness: 180, damping: 22, mass: 1.0 },
} as const satisfies Record<string, Transition>;

export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
  in: [0.7, 0, 0.84, 0] as [number, number, number, number],
};

export const duration = {
  instant: 0.09,
  fast: 0.16,
  normal: 0.26,
  slow: 0.42,
  page: 0.5,
};

/** Stagger helper for panel/section entrances. */
export const stagger = (index: number, step = 0.03, base = 0.04): Transition => ({
  ...spring.smooth,
  delay: base + index * step,
});

export const pageTransition = {
  initial: { opacity: 0, y: 12, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)' },
  transition: spring.swell as Transition,
};

/** Instant transitions when "Reduce motion" is on (§3.4). */
export const instant: Transition = { duration: 0 };
