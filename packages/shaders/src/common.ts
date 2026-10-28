/**
 * Shared GLSL (ES 3.00) chunks. Every fragment shader is assembled as
 * `HEADER + COMMON + <pass-specific>`.
 *
 * Colour pipeline contract (docs/PIPELINE.md):
 *   source texture  : 8-bit sRGB (as decoded)
 *   working buffers : **linear Rec.2020**, RGBA16F where available
 *   display/export  : linear → target space → gamma encode
 */

export const GLSL_HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

export const QUAD_VERT = `#version 300 es
precision highp float;
// Fullscreen triangle — no VBO needed, gl_VertexID only.
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const COMMON = /* glsl */ `
in vec2 vUv;

#define PI  3.141592653589793
#define TAU 6.283185307179586

/* ------------------------------------------------------- colour spaces */

vec3 srgbToLinear(vec3 c) {
  vec3 a = abs(c);
  vec3 lo = a / 12.92;
  vec3 hi = pow((a + 0.055) / 1.055, vec3(2.4));
  vec3 v = mix(hi, lo, step(a, vec3(0.04045)));
  return sign(c) * v;
}

vec3 linearToSrgb(vec3 c) {
  vec3 a = abs(c);
  vec3 lo = a * 12.92;
  vec3 hi = 1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055;
  vec3 v = mix(hi, lo, step(a, vec3(0.0031308)));
  return sign(c) * v;
}

/* sRGB (D65) linear <-> Rec.2020 linear — the Swell working space */
const mat3 M_SRGB_TO_2020 = mat3(
  0.6274041, 0.0690972, 0.0163915,
  0.3292830, 0.9195404, 0.0880133,
  0.0433129, 0.0113624, 0.8955952
);
/* columns — mirrors M_2020_TO_SRGB in packages/shared/src/color.ts */
const mat3 M_2020_TO_SRGB = mat3(
  1.6604910, -0.1245505, -0.0181508,
  -0.5876411, 1.1328999, -0.1005789,
  -0.0728499, -0.0083494, 1.1187297
);

/* Rec.2020 luminance coefficients */
float luma2020(vec3 c) { return dot(c, vec3(0.2627, 0.6780, 0.0593)); }
float luma709(vec3 c)  { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* ------------------------------------------------- OKLab (for hue work) */

const mat3 M_OKLAB_1 = mat3(
  0.4122214708, 0.2119034982, 0.0883024619,
  0.5363325363, 0.6806995451, 0.2817188376,
  0.0514459929, 0.1073969566, 0.6299787005
);
const mat3 M_OKLAB_2 = mat3(
  0.2104542553, 1.9779984951, 0.0259040371,
  0.7936177850, -2.4285922050, 0.7827717662,
  -0.0040720468, 0.4505937099, -0.8086757660
);
/* Lab -> cube-root LMS */
const mat3 M_OKLAB_2_INV = mat3(
  1.0, 1.0, 1.0,
  0.3963377774, -0.1055613458, -0.0894841775,
  0.2158037573, -0.0638541728, -1.2914855480
);
/* LMS -> linear sRGB */
const mat3 M_OKLAB_1_INV = mat3(
  4.0767416621, -1.2684380046, -0.0041960863,
  -3.3077115913, 2.6097574011, -0.7034186147,
  0.2309699292, -0.3413193965, 1.7076147010
);

vec3 linearToOklab(vec3 c) {
  vec3 lms = M_OKLAB_1 * c;
  lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
  return M_OKLAB_2 * lms;
}

vec3 oklabToLinear(vec3 lab) {
  vec3 lms = M_OKLAB_2_INV * lab;
  lms = lms * lms * lms;
  return M_OKLAB_1_INV * lms;
}

/* returns (L, C, H) with H in 0..1 */
vec3 oklabToOklch(vec3 lab) {
  float c = length(lab.gb);
  float h = atan(lab.b, lab.a) / TAU;
  if (h < 0.0) h += 1.0;
  return vec3(lab.r, c, h);
}

vec3 oklchToOklab(vec3 lch) {
  float a = lch.y * cos(lch.z * TAU);
  float b = lch.y * sin(lch.z * TAU);
  return vec3(lch.x, a, b);
}

/* ------------------------------------------------ curve domain encoding
 * enc/dec mirror packages/shared/src/curve.ts exactly (CURVE_K = 12).
 */
const float CURVE_K = 12.0;
const float LOG2_1PK = 3.700439718141093; // log2(13)

float encP(float y) { return log2(1.0 + CURVE_K * clamp(y, 0.0, 4.0)) / LOG2_1PK; }
float decP(float e) { return (exp2(clamp(e, 0.0, 1.0) * LOG2_1PK) - 1.0) / CURVE_K; }

/* ------------------------------------------------------------- helpers */

float satf(float v, float lo, float hi) { return clamp((v - lo) / max(hi - lo, 1e-5), 0.0, 1.0); }

float bell(float x, float centre, float width) {
  float d = (x - centre) / max(width, 1e-4);
  return exp(-d * d);
}

/* Cosine bell over [lo, hi], 0 outside. Used by region-weighted sliders. */
float region(float x, float lo, float hi) {
  if (x <= lo || x >= hi) return 0.0;
  return 0.5 - 0.5 * cos(TAU * (x - lo) / (hi - lo));
}

/* Luminance-ratio scaling with a gamut-safe clamp: keeps hue, avoids blowout. */
vec3 scaleLuma(vec3 c, float targetY) {
  float y = luma2020(c);
  float ratio = targetY / max(y, 1e-4);
  vec3 outc = c * ratio;
  // Desaturate gently as channels clip, instead of hue-shifting hard.
  float mx = max(max(outc.r, outc.g), outc.b);
  if (mx > 1.0) {
    float ny = luma2020(outc);
    outc = mix(outc, vec3(ny), satf(mx - 1.0, 0.0, 0.35) * 0.7);
    outc /= max(mx, 1.0);
  }
  return max(outc, vec3(0.0));
}

/* Deterministic hash noise for grain/dither (no textures, no state). */
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

/* ------------------------------------------------------- blend modes */

float lumOf(vec3 c) { return luma2020(c); }

vec3 blendMode(int mode, vec3 base, vec3 blend, float opacity) {
  vec3 r = base;
  if (mode == 0) r = blend;                                              // normal
  else if (mode == 1) r = base * blend;                                  // multiply
  else if (mode == 2) r = 1.0 - (1.0 - base) * (1.0 - blend);            // screen
  else if (mode == 3) {                                                  // overlay
    r = mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(vec3(0.5), base));
  } else if (mode == 4) {                                                // soft light (pegtop)
    r = (1.0 - 2.0 * blend) * base * base + 2.0 * blend * base;
  } else if (mode == 5) {                                                // hard light
    r = mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(vec3(0.5), blend));
  } else if (mode == 6) {                                                // colour dodge
    r = min(base / max(vec3(1.0) - blend, vec3(1e-3)), vec3(4.0));
  } else if (mode == 7) {                                                // colour burn
    r = 1.0 - min((1.0 - base) / max(blend, vec3(1e-3)), vec3(4.0));
  } else if (mode == 8) r = min(base, blend);                            // darken
  else if (mode == 9) r = max(base, blend);                              // lighten
  else if (mode == 10) r = abs(base - blend);                            // difference
  else if (mode == 11) r = 0.5 - 2.0 * (base - 0.5) * (blend - 0.5);     // exclusion
  else if (mode == 12 || mode == 13 || mode == 14 || mode == 15) {
    // hue / saturation / colour / luminosity via OKLab
    vec3 bb = linearToOklab(max(base, vec3(0.0)));
    vec3 bl = linearToOklab(max(blend, vec3(0.0)));
    vec3 lchB = oklabToOklch(bb);
    vec3 lchL = oklabToOklch(bl);
    vec3 outlch = lchB;
    if (mode == 12) outlch.z = lchL.z;                 // hue
    if (mode == 13) outlch.y = lchL.y;                 // saturation
    if (mode == 14) { outlch.z = lchL.z; outlch.y = lchL.y; } // colour
    if (mode == 15) outlch.x = lchL.x;                 // luminosity
    r = max(oklabToLinear(oklchToOklab(outlch)), vec3(0.0));
  } else if (mode == 16) r = min(base + blend, vec3(4.0));               // add
  return mix(base, r, clamp(opacity, 0.0, 1.0));
}
`;

/** Uniform block shared by passes that need the source geometry. */
export const SOURCE_UNIFORMS = /* glsl */ `
uniform vec2 uSrcSize;     // source pixel size
uniform vec2 uDstSize;     // render target pixel size
uniform float uTime;
`;
