/**
 * Colour spaces for output transforms and soft proofing (§5.1, §10.1).
 *
 * All matrices are **row-major** in TypeScript (`applyMat3` convention) and are
 * transposed when uploaded to GLSL, which is column-major.
 */

import {
  M_2020_TO_SRGB,
  M_SRGB_TO_2020,
  M_LRGB_TO_XYZ,
  M_XYZ_TO_LRGB,
  applyMat3,
  invertMat3,
  mulMat3,
  type Mat3,
  type RGB,
} from './color.ts';

export const M_XYZ_TO_ADOBERGB: Mat3 = [
  2.0415879, -0.565007, -0.3447314, -0.9692436, 1.8759675, 0.0415551, 0.0134443, -0.1183624,
  1.015175,
];
export const M_ADOBERGB_TO_XYZ: Mat3 = [
  0.576669, 0.1855582, 0.1882286, 0.297345, 0.6273636, 0.0752915, 0.0270314, 0.0706889,
  0.9913375,
];

export const M_XYZ_TO_P3: Mat3 = [
  2.4934969, -0.9313836, -0.4027108, -0.829489, 1.7626641, 0.0236247, 0.0358458, -0.0761724,
  0.9568845,
];
export const M_P3_TO_XYZ: Mat3 = [
  0.4865709, 0.2656677, 0.1982173, 0.2289746, 0.6917385, 0.0792869, 0.0, 0.0451134,
  1.0439444,
];

/**
 * ProPhoto RGB (ROMM) is specified against D50, while sRGB / Display P3 /
 * Adobe RGB and our Rec.2020 working space are D65. Using the D50 matrices
 * directly makes a ProPhoto soft proof shift warm and blow out white, so both
 * directions carry a Bradford chromatic adaptation.
 */
export const M_XYZ_TO_PROPHOTO_D50: Mat3 = [
  1.345799, -0.2555801, -0.0511063, -0.5446225, 1.5082327, 0.020536, 0.0, 0.0, 1.2119675,
];
export const M_PROPHOTO_TO_XYZ_D50: Mat3 = [
  0.7977605, 0.1351858, 0.0313493, 0.2880711, 0.7118432, 0.0000857, 0.0, 0.0, 0.8251046,
];

/** Bradford cone-response adaptation, XYZ(D50) → XYZ(D65). */
export const BRADFORD_D50_TO_D65: Mat3 = [
  0.9555766, -0.0230393, 0.0631636, -0.0282895, 1.0099416, 0.0210077, 0.0122982, -0.020483,
  1.3299098,
];
/**
 * Its inverse, XYZ(D65) → XYZ(D50), computed rather than hard-coded so the pair
 * is exactly invertible (published rounded tables are not).
 */
export const BRADFORD_D65_TO_D50: Mat3 = invertMat3(BRADFORD_D50_TO_D65);

/** ProPhoto ↔ D65 XYZ, i.e. the matrices the pipeline actually uses. */
export const M_PROPHOTO_TO_XYZ: Mat3 = mulMat3(BRADFORD_D50_TO_D65, M_PROPHOTO_TO_XYZ_D50);
export const M_XYZ_TO_PROPHOTO: Mat3 = mulMat3(M_XYZ_TO_PROPHOTO_D50, BRADFORD_D65_TO_D50);

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export type ColorSpaceId =
  | 'rec2020'
  | 'prophoto'
  | 'srgb'
  | 'adobergb'
  | 'displayP3';

export const COLOR_SPACES: { id: ColorSpaceId; label: string; gamut: 'wide' | 'medium' | 'small' }[] = [
  { id: 'rec2020', label: 'Rec.2020 (working)', gamut: 'wide' },
  { id: 'prophoto', label: 'ProPhoto RGB', gamut: 'wide' },
  { id: 'adobergb', label: 'Adobe RGB (1998)', gamut: 'medium' },
  { id: 'displayP3', label: 'Display P3', gamut: 'medium' },
  { id: 'srgb', label: 'sRGB', gamut: 'small' },
];

/** Linear Rec.2020 → the given space. */
export function from2020(space: ColorSpaceId): Mat3 {
  switch (space) {
    case 'rec2020':
      return IDENTITY;
    case 'srgb':
      return M_2020_TO_SRGB;
    case 'adobergb':
      return mulMat3(M_XYZ_TO_ADOBERGB, mulMat3(m2020ToXyz(), IDENTITY));
    case 'displayP3':
      return mulMat3(M_XYZ_TO_P3, m2020ToXyz());
    case 'prophoto':
      return mulMat3(M_XYZ_TO_PROPHOTO, m2020ToXyz());
  }
}

/** The given space → linear Rec.2020. */
export function to2020(space: ColorSpaceId): Mat3 {
  switch (space) {
    case 'rec2020':
      return IDENTITY;
    case 'srgb':
      return M_SRGB_TO_2020;
    case 'adobergb':
      return mulMat3(xyzTo2020(), M_ADOBERGB_TO_XYZ);
    case 'displayP3':
      return mulMat3(xyzTo2020(), M_P3_TO_XYZ);
    case 'prophoto':
      return mulMat3(xyzTo2020(), M_PROPHOTO_TO_XYZ);
  }
}

const M_2020_TO_XYZ: Mat3 = mulMat3(M_LRGB_TO_XYZ, M_2020_TO_SRGB);
const M_XYZ_TO_2020: Mat3 = mulMat3(M_SRGB_TO_2020, M_XYZ_TO_LRGB);
const m2020ToXyz = () => M_2020_TO_XYZ;
const xyzTo2020 = () => M_XYZ_TO_2020;

/** Space → sRGB display (used as the output matrix when soft-proofing). */
export function spaceToSrgb(space: ColorSpaceId): Mat3 {
  switch (space) {
    case 'srgb':
      return IDENTITY;
    case 'adobergb':
      return mulMat3(M_XYZ_TO_LRGB, M_ADOBERGB_TO_XYZ);
    case 'displayP3':
      return mulMat3(M_XYZ_TO_LRGB, M_P3_TO_XYZ);
    case 'prophoto':
      return mulMat3(M_XYZ_TO_LRGB, M_PROPHOTO_TO_XYZ);
    case 'rec2020':
      return M_2020_TO_SRGB;
  }
}

/** Column-major Float32Array for `uniformMatrix3fv`. */
export function toGlMat3(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

export const applySpace = (space: ColorSpaceId, c: RGB): RGB => applyMat3(from2020(space), c);
