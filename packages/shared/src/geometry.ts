/**
 * Geometry helpers shared by the UI and the engine: guided upright solving and
 * the mapping between homography coefficients and user-facing slider units.
 */

import { clamp } from './color.ts';

export interface GuideLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface UprightSolution {
  /** rotation to apply, radians (image space, y down) */
  rotate: number;
  /** vertical keystone coefficient, −0.8…0.8 */
  ky: number;
  /** horizontal keystone coefficient, −0.8…0.8 */
  kx: number;
}

/**
 * Guided Upright: average the drawn guides' angles, infer perspective.
 * Lines closer to vertical correct converging verticals; the rest level the
 * horizon. Two vertical guides are enough for a perspective solve.
 */
export function guidedUpright(lines: GuideLine[]): UprightSolution {
  let rot = 0;
  let n = 0;
  let ky = 0;
  let kx = 0;
  const vertical: number[] = [];
  const horizontal: number[] = [];

  for (const l of lines) {
    const dx = l.x1 - l.x0;
    const dy = l.y1 - l.y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(Math.abs(ang) - Math.PI / 2) < Math.PI / 4) vertical.push(ang);
    else horizontal.push(ang);
    n++;
  }

  if (vertical.length >= 2) {
    const spread = vertical[vertical.length - 1]! - vertical[0]!;
    ky = clamp(spread * 1.4, -0.8, 0.8);
    rot += (vertical[0]! + vertical[vertical.length - 1]!) / 2 - Math.PI / 2;
  } else if (vertical.length === 1) {
    rot += vertical[0]! - Math.PI / 2;
  }

  if (horizontal.length >= 1) {
    const avg = horizontal.reduce((a, b) => a + b, 0) / horizontal.length;
    rot += avg;
    if (horizontal.length >= 2) kx = clamp((horizontal[1]! - horizontal[0]!) * 1.2, -0.8, 0.8);
  }

  return { rotate: rot / Math.max(1, n / 2), ky, kx };
}

/** Convert a solve into DevelopParams.geometry units (degrees, −100…100). */
export function uprightToParams(s: UprightSolution): { rotate: number; vertical: number; horizontal: number } {
  return {
    rotate: clamp((s.rotate * 180) / Math.PI, -45, 45),
    vertical: clamp((s.ky / 0.8) * 100, -100, 100),
    horizontal: clamp((s.kx / 0.8) * 100, -100, 100),
  };
}

/** Auto-level from a detected horizon tilt (degrees, image space). */
export function autoLevel(tiltDegrees: number, mode: 'level' | 'vertical' | 'full' | 'auto'): { angle: number; vertical: number } {
  const angle = mode === 'vertical' ? 0 : clamp(-tiltDegrees, -45, 45);
  const vertical = mode === 'level' ? 0 : mode === 'vertical' || mode === 'full' || mode === 'auto' ? 32 : 0;
  return { angle, vertical };
}
