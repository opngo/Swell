/**
 * Pass shaders (GLSL ES 3.00, WebGL2).
 *
 * Orientation contract — important, easy to get wrong:
 *   • every texture/FBO stores image space with t = 0 at the **image top**
 *   • all passes except the final output blit sample with `vUv` unchanged
 *     (identity blits preserve that convention)
 *   • the output pass flips once (`suv = vec2(vUv.x, 1.0 - vUv.y)`) because the
 *     default framebuffer's row 0 is drawn at the bottom of the canvas
 *   • all UI-facing mask coordinates (gradients, brush strokes, pins) are
 *     normalised image space, origin top-left, y down
 */

import { COMMON, GLSL_HEADER } from './common.ts';

const frag = (body: string) => `${GLSL_HEADER}${COMMON}${body}`;

/** Layer tiles in the mask atlas: 8 × 256 px = 2048 px wide (WebGL2 minimum max texture size). */
export const MASK_TILES = 8;
export const MASK_TILE_W = 256;

/* ------------------------------------------------------------------- blur */

export const BLUR_FRAG = frag(/* glsl */ `
uniform sampler2D uTex;
uniform vec2 uDir;   // texel size × radius × axis
out vec4 oColor;

void main() {
  vec3 sum = texture(uTex, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += (texture(uTex, vUv + o1).rgb + texture(uTex, vUv - o1).rgb) * 0.3162162162;
  sum += (texture(uTex, vUv + o2).rgb + texture(uTex, vUv - o2).rgb) * 0.0702702703;
  oColor = vec4(sum, 1.0);
}
`);

/* ------------------------------------------------------------------- copy */

export const COPY_FRAG = frag(/* glsl */ `
uniform sampler2D uTex;
uniform float uFlipY;
out vec4 oColor;
void main() {
  vec2 uv = mix(vUv, vec2(vUv.x, 1.0 - vUv.y), uFlipY);
  oColor = texture(uTex, uv);
}
`);

/* ------------------------------------------------------------------- mask */

/**
 * Renders ONE mask into one tile of the atlas (viewport-scissored per tile).
 * Everything is analytic except AI mattes, which are sampled from `uMatte`.
 */
export const MASK_FRAG = frag(/* glsl */ `
uniform int uKind;        // 0 none,1 linear,2 radial,3 luminance,4 colour,5 matte,6 brush,7 depth
uniform vec4 uMaskA;      // linear: x0 y0 x1 y1 | radial: cx cy rx ry | luma: lo hi smooth 0 | colour: l c h fuzz
uniform vec4 uMaskB;      // feather, invert, amount, rotation
uniform vec4 uMaskC;      // second colour sample: l c h weight
uniform vec4 uRange;      // luminance-range refine: lo, hi, smooth, enabled
uniform vec2 uAspect;     // (frameW/frameH, 1) so radial/brush masks are not stretched
uniform sampler2D uSrcLin;
uniform sampler2D uMatte;
uniform int uMatteMode;   // 0 subject, 1 sky, 2 background
uniform vec4 uMatteRefine;// shift, smooth, feather, enabled
uniform int uAddCount;
uniform int uSubCount;
uniform vec4 uAdd[48];    // brush circles: x, y, radius, feather
uniform vec4 uSub[16];
uniform float uFlow;
out vec4 oColor;

float circleMask(vec2 uv, vec4 c) {
  vec2 d = (uv - c.xy) * uAspect;
  float dist = length(d);
  float r = max(c.z, 1e-4);
  float f = clamp(c.w, 0.0, 0.98);
  return 1.0 - smoothstep(r * (1.0 - f), r, dist);
}

float rangeWeight(float y, float lo, float hi, float smoothAmt) {
  float s = max(smoothAmt, 0.002);
  return smoothstep(lo - s, lo + s, y) * (1.0 - smoothstep(hi - s, hi + s, y));
}

void main() {
  vec2 uv = vUv;              // image space, y down
  float m = 1.0;

  if (uKind == 1) {
    vec2 p0 = uMaskA.xy;
    vec2 d = uMaskA.zw - p0;
    float len2 = max(dot(d, d), 1e-6);
    float t = dot(uv - p0, d) / len2;
    float feather = max(uMaskB.x, 0.002);
    m = smoothstep(-feather, 1.0 + feather, t);
  } else if (uKind == 2) {
    vec2 p = (uv - uMaskA.xy) * uAspect;
    vec2 r = max(uMaskA.zw, vec2(1e-4)) * uAspect;
    float rot = uMaskB.w;
    float cs = cos(rot), sn = sin(rot);
    p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
    float d = length(p / r);
    float feather = max(uMaskB.x, 0.002);
    m = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, d);
  } else if (uKind == 3) {
    float y = encP(luma2020(texture(uSrcLin, uv).rgb));
    m = rangeWeight(y, uMaskA.x, uMaskA.y, uMaskA.z);
  } else if (uKind == 4) {
    vec3 lch = oklabToOklch(linearToOklab(max(texture(uSrcLin, uv).rgb, vec3(0.0))));
    float fuzz = max(uMaskA.w, 0.01);
    float dh1 = min(abs(lch.z - uMaskA.z), 1.0 - abs(lch.z - uMaskA.z));
    float d1 = sqrt(pow((lch.x - uMaskA.x) * 1.4, 2.0) + pow(lch.y - uMaskA.y, 2.0) + pow(dh1 * 1.6, 2.0));
    m = 1.0 - smoothstep(fuzz * 0.5, fuzz, d1);
    if (uMaskC.w > 0.0) {
      float dh2 = min(abs(lch.z - uMaskC.z), 1.0 - abs(lch.z - uMaskC.z));
      float d2 = sqrt(pow((lch.x - uMaskC.x) * 1.4, 2.0) + pow(lch.y - uMaskC.y, 2.0) + pow(dh2 * 1.6, 2.0));
      m = max(m, 1.0 - smoothstep(fuzz * 0.5, fuzz, d2));
    }
  } else if (uKind == 5) {
    float a = texture(uMatte, uv).r;
    if (uMatteRefine.w > 0.5) {
      // shift edge + smooth + feather, all in one cheap reshaping curve
      a = clamp((a - 0.5 - uMatteRefine.x * 0.35) / max(1.0 - uMatteRefine.y * 0.6, 0.15) + 0.5, 0.0, 1.0);
      a = smoothstep(clamp(uMatteRefine.z * 0.5, 0.0, 0.49), 1.0 - clamp(uMatteRefine.z * 0.5, 0.0, 0.49), a);
    }
    if (uMatteMode == 1) {
      vec3 src = texture(uSrcLin, uv).rgb;
      float y = encP(luma2020(src));
      float chroma = oklabToOklch(linearToOklab(max(src, vec3(0.0)))).y;
      float skyish = smoothstep(0.42, 0.80, y) * (1.0 - smoothstep(0.05, 0.20, chroma));
      float topBias = 1.0 - smoothstep(0.05, 0.8, uv.y);
      m = clamp(max(a * 0.6, skyish * (0.3 + 0.7 * topBias)), 0.0, 1.0);
    } else if (uMatteMode == 2) {
      m = 1.0 - a;
    } else {
      m = a;
    }
  } else if (uKind == 6) {
    float acc = 0.0;
    for (int i = 0; i < 48; i++) {
      if (i >= uAddCount) break;
      acc = max(acc, circleMask(uv, uAdd[i]) * uFlow);
    }
    for (int i = 0; i < 16; i++) {
      if (i >= uSubCount) break;
      acc *= (1.0 - circleMask(uv, uSub[i]));
    }
    m = acc;
  } else if (uKind == 7) {
    // Depth range. The desktop build binds a real Depth-Anything map here; the
    // web runtime uses a centre-distance proxy so the control stays meaningful.
    vec2 d = (uv - vec2(0.5)) * uAspect;
    float depth = clamp(length(d) * 1.55, 0.0, 1.0);
    m = rangeWeight(depth, uMaskA.x, uMaskA.y, uMaskA.z);
  }

  if (uRange.w > 0.5) {
    float y = encP(luma2020(texture(uSrcLin, uv).rgb));
    m *= rangeWeight(y, uRange.x, uRange.y, uRange.z);
  }

  if (uMaskB.y > 0.5) m = 1.0 - m;
  m *= clamp(uMaskB.z, 0.0, 1.0);
  oColor = vec4(vec3(clamp(m, 0.0, 1.0)), 1.0);
}
`);

/* --------------------------------------------------------------- removals */

/**
 * Spot removal / object removal (§4.7), evaluated in linear working space
 * on the source so the result can be cached and reused across develop passes.
 *
 * `inpaint` is an iterative diffusion fill — the deterministic stand-in for
 * LaMa. The desktop build swaps in the ONNX session without changing callers.
 */
export const REMOVAL_FRAG = frag(/* glsl */ `
uniform sampler2D uTex;        // current buffer (ping-pong)
uniform sampler2D uOriginal;   // untouched linear source
uniform sampler2D uMask;       // op mask tile
uniform vec2 uTexel;
uniform vec2 uOffset;          // clone/heal source offset, normalised
uniform int uMode;             // 0 heal, 1 clone, 2 inpaint, 3 redEye
uniform float uStrength;
uniform float uIter;           // 0..1 diffusion progress
out vec4 oColor;

void main() {
  vec3 base = texture(uTex, vUv).rgb;
  float m = texture(uMask, vUv).r * clamp(uStrength, 0.0, 1.0);
  if (m <= 0.0005) { oColor = vec4(base, 1.0); return; }

  if (uMode == 2) {
    vec3 n = texture(uTex, vUv + vec2(uTexel.x, 0.0)).rgb;
    vec3 s = texture(uTex, vUv - vec2(uTexel.x, 0.0)).rgb;
    vec3 e = texture(uTex, vUv + vec2(0.0, uTexel.y)).rgb;
    vec3 w = texture(uTex, vUv - vec2(0.0, uTexel.y)).rgb;
    vec3 avg = (n + s + e + w) * 0.25;
    float pull = clamp(m * (0.30 + uIter * 0.70), 0.0, 1.0);
    oColor = vec4(max(mix(base, avg, pull), vec3(0.0)), 1.0);
    return;
  }

  vec2 srcUv = clamp(vUv + uOffset, vec2(0.002), vec2(0.998));
  vec3 patchColor = texture(uOriginal, srcUv).rgb;

  if (uMode == 0) {
    // heal: patch texture, destination luminance (ring average)
    vec3 ring = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * TAU / 8.0;
      ring += texture(uOriginal, clamp(vUv + vec2(cos(a), sin(a)) * uTexel * 4.0, vec2(0.0), vec2(1.0))).rgb;
    }
    vec3 destAvg = ring / 8.0;
    vec3 healed = patchColor - texture(uOriginal, srcUv).rgb + destAvg;
    oColor = vec4(mix(base, max(healed, vec3(0.0)), m), 1.0);
    return;
  }

  if (uMode == 3) {
    vec3 orig = texture(uOriginal, vUv).rgb;
    float y = luma2020(orig);
    vec3 fixedTone = mix(vec3(y * 0.5), orig, smoothstep(0.5, 0.85, y));
    oColor = vec4(mix(base, fixedTone, m), 1.0);
    return;
  }

  oColor = vec4(mix(base, patchColor, m), 1.0);
}
`);

/* ---------------------------------------------------------------- develop */

export const MAX_LAYERS = MASK_TILES;

export const DEVELOP_FRAG = frag(/* glsl */ `
uniform sampler2D uSrc;         // linear Rec.2020 source (post-removals)
uniform sampler2D uBlurSmall;   // ~1.5 px  — texture / sharpening / NR
uniform sampler2D uBlurLarge;   // ~14 px   — clarity / dehaze / glow
uniform sampler2D uMaskAtlas;   // 8 tiles
uniform sampler2D uLutLuma;     // 1-D encoded-domain luma curve
uniform sampler2D uLutRgb;      // 1-D per-channel curves, packed RGB
uniform sampler2D uLutHue;      // hue-indexed deltas: hh, hs, hl, ls
uniform sampler2D uLutHue2;     // ss
uniform sampler2D uLut3d;       // optional .cube creative LUT
uniform sampler2D uImage0;
uniform sampler2D uImage1;

uniform int uHasLut3d;
uniform int uHasImage0;
uniform int uHasImage1;
uniform float uLutSize;
uniform float uHueLutSize;
uniform int uMaxTiles;

/* white balance / profile / calibration */
uniform vec3 uWbGain;
uniform mat3 uCalibration;
uniform float uProfileAmount;

/* tone */
uniform float uExposure;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;

/* presence */
uniform float uTexture;
uniform float uClarity;
uniform float uDehaze;
uniform float uVibrance;
uniform float uSaturation;
uniform int uTreatment;

/* curves */
uniform float uCurveAmount;
uniform int uLockLuminosity;
uniform int uHasRgbCurve;
uniform int uHasHueCurve;

/* colour mixer */
uniform float uMixerH[8];
uniform float uMixerS[8];
uniform float uMixerL[8];
uniform float uMixerAmount;

/* point colour */
uniform int uPointCount;
uniform vec4 uPointA[4];   // l, c, h, hueRange
uniform vec4 uPointB[4];   // hueShift, sat, lum, satRange
uniform vec4 uPointC[4];   // lumRange, 0, 0, 0

/* grading */
uniform vec4 uGradeShadow; // hue(0..1), sat(0..1), lum(-100..100), weight
uniform vec4 uGradeMid;
uniform vec4 uGradeHigh;
uniform vec4 uGradeGlobal;
uniform vec2 uGradeBlend;  // blend, balance

/* detail */
uniform vec4 uSharpen;     // amount, radius, detail, masking
uniform vec4 uNoise;       // luminance, detail, contrast, colour

/* lens + geometry */
uniform vec4 uLens;        // distortion, caAmount, vignetting, defringe
uniform int uLensEnabled;
uniform mat3 uGeometry;

/* effects */
uniform vec4 uVignette;    // amount, midpoint, roundness, feather
uniform vec2 uVignette2;   // style, highlights
uniform vec3 uGrain;       // amount, size, roughness

/* layers */
uniform int uLayerCount;
uniform vec4 uLayerOp[8];      // opacity, blendMode, hasMask, kind (0 adjust, 1 img0, 2 img1, 3 fill)
uniform vec4 uLayerAdjA[8];    // exposure, contrast, highlights, shadows
uniform vec4 uLayerAdjB[8];    // whites, blacks, temp, tint
uniform vec4 uLayerAdjC[8];    // vibrance, saturation, clarity, texture
uniform vec4 uLayerAdjD[8];    // dehaze, sharpness, grain, glow
uniform vec4 uLayerImg[2];     // x, y, scale, rotation
uniform vec4 uLayerImg2[2];    // aspect, flipH, flipV, opacity
uniform vec4 uFillLayer[8];    // r, g, b, kind (0 none, 1 solid, 2 gradient, 3 noise)
uniform vec4 uFillLayer2[8];   // r2, g2, b2, angle

/* cutout / soft proof */
uniform int uCutoutEnabled;
uniform sampler2D uCutout;
uniform float uCutoutInvert;
uniform int uProofEnabled;
uniform mat3 uProofMatrix;
uniform float uProofPaper;

out vec4 oColor;

const int LAYERS = 8;

float mixerHue(int ch) {
  if (ch == 0) return 0.080;   // red
  if (ch == 1) return 0.150;   // orange
  if (ch == 2) return 0.262;   // yellow
  if (ch == 3) return 0.400;   // green
  if (ch == 4) return 0.540;   // aqua
  if (ch == 5) return 0.690;   // blue
  if (ch == 6) return 0.815;   // purple
  return 0.920;                // magenta
}

float channelWeight(float h, int ch) {
  float d = abs(h - mixerHue(ch));
  d = min(d, 1.0 - d);
  return max(0.0, 1.0 - d / 0.118);
}

float lutLuma(float e) {
  float u = (clamp(e, 0.0, 1.0) * (uLutSize - 1.0) + 0.5) / uLutSize;
  return texture(uLutLuma, vec2(u, 0.5)).r;
}

vec3 lutRgb(float e, int ch) {
  float u = (clamp(e, 0.0, 1.0) * (uLutSize - 1.0) + 0.5) / uLutSize;
  vec3 v = texture(uLutRgb, vec2(u, 0.5)).rgb;
  if (ch == 0) return vec3(v.r);
  if (ch == 1) return vec3(v.g);
  return vec3(v.b);
}

vec4 lutHue(float h) {
  float u = (fract(h) * (uHueLutSize - 1.0) + 0.5) / uHueLutSize;
  return texture(uLutHue, vec2(u, 0.5));
}

float lutHue2(float x) {
  float u = (clamp(x, 0.0, 1.0) * (uHueLutSize - 1.0) + 0.5) / uHueLutSize;
  return texture(uLutHue2, vec2(u, 0.5)).r;
}

vec3 applyTone(vec3 c, float exposure, float contrast, float highlights,
               float shadows, float whites, float blacks) {
  c *= pow(2.0, exposure);
  float y = luma2020(c);
  float e = encP(y);
  e += (contrast / 100.0) * 0.55 * (e - 0.5) * (1.0 - abs(e - 0.5) * 0.35);
  e += (highlights / 100.0) * region(e, 0.42, 1.0) * 0.42;
  e += (shadows / 100.0) * region(e, 0.0, 0.58) * 0.45;
  e += (whites / 100.0) * smoothstep(0.72, 1.0, e) * 0.28;
  e += (blacks / 100.0) * (1.0 - smoothstep(0.0, 0.28, e)) * 0.30;
  return scaleLuma(c, max(decP(clamp(e, 0.0, 1.0)), 0.0));
}

vec3 applyPresence(vec3 c, vec2 uv, float textureAmt, float clarityAmt, float dehazeAmt) {
  vec3 small = texture(uBlurSmall, uv).rgb;
  vec3 large = texture(uBlurLarge, uv).rgb;
  float mid = region(encP(luma2020(c)), 0.10, 0.94);
  if (abs(clarityAmt) > 0.001) c += (c - large) * (clarityAmt / 100.0) * 0.85 * (0.35 + mid * 0.65);
  if (abs(textureAmt) > 0.001) c += (large - small) * (textureAmt / 100.0) * 1.15 * (0.30 + mid * 0.70);
  if (abs(dehazeAmt) > 0.001) {
    float d = dehazeAmt / 100.0;
    c = (c - large * 0.92 * d) / max(1.0 - d * 0.75, 0.25);
    c *= 1.0 + d * 0.12;
  }
  return max(c, vec3(0.0));
}

vec3 applySaturation(vec3 c, float vibrance, float saturation) {
  vec3 lab = linearToOklab(max(c, vec3(0.0)));
  vec3 lch = oklabToOklch(lab);
  float sat = clamp(lch.y / max(lch.x, 1e-3) * 2.2, 0.0, 1.0);
  float vib = 1.0 + (vibrance / 100.0) * (1.0 - sat) * 0.95;
  float skin = bell(lch.z, 0.10, 0.11) * smoothstep(0.02, 0.09, lch.y);
  vib = mix(vib, 1.0 + (vibrance / 100.0) * 0.35, skin * 0.7);
  lch.y *= clamp(vib * (1.0 + saturation / 100.0), 0.0, 4.0);
  return max(oklabToLinear(oklchToOklab(lch)), vec3(0.0));
}

vec3 applyMixer(vec3 c) {
  vec3 lch = oklabToOklch(linearToOklab(max(c, vec3(0.0))));
  float dh = 0.0, ds = 1.0, dl = 1.0;
  for (int ch = 0; ch < 8; ch++) {
    float w = channelWeight(lch.z, ch);
    if (w <= 0.0002) continue;
    dh += uMixerH[ch] * w;
    ds *= 1.0 + (uMixerS[ch] / 100.0) * w * 0.90;
    dl *= 1.0 + (uMixerL[ch] / 100.0) * w * 0.75;
  }
  lch.z = fract(lch.z + (dh / 100.0) * 0.145 * uMixerAmount);
  lch.y *= clamp(ds, 0.0, 3.0);
  lch.x *= clamp(dl, 0.0, 3.0);
  return max(oklabToLinear(oklchToOklab(lch)), vec3(0.0));
}

vec3 applyHueCurves(vec3 c) {
  vec3 lch = oklabToOklch(linearToOklab(max(c, vec3(0.0))));
  vec4 hh = lutHue(lch.z);
  lch.z = fract(lch.z + hh.x);
  lch.y *= clamp(1.0 + hh.y, 0.0, 3.0);
  lch.x *= clamp(1.0 + hh.z, 0.0, 3.0);
  lch.y *= clamp(1.0 + lutHue2(lch.x), 0.0, 3.0);   // luminance vs saturation
  lch.y *= clamp(1.0 + lutHue(lch.y).w, 0.0, 3.0);  // saturation vs saturation
  return max(oklabToLinear(oklchToOklab(lch)), vec3(0.0));
}

vec3 applyPointColor(vec3 c) {
  if (uPointCount <= 0) return c;
  vec3 lch = oklabToOklch(linearToOklab(max(c, vec3(0.0))));
  for (int i = 0; i < 4; i++) {
    if (i >= uPointCount) break;
    vec4 a = uPointA[i];
    vec4 b = uPointB[i];
    float lumRange = uPointC[i].x;
    float dh = min(abs(lch.z - a.z), 1.0 - abs(lch.z - a.z));
    float w = (1.0 - smoothstep(a.w * 0.4, max(a.w, 0.001), dh))
            * (1.0 - smoothstep(b.w * 0.5, max(b.w, 0.001), abs(lch.y - a.y)))
            * (1.0 - smoothstep(lumRange * 0.5, max(lumRange, 0.001), abs(lch.x - a.x)));
    if (w <= 0.002) continue;
    lch.z = fract(lch.z + (b.x / 360.0) * w);
    lch.y *= 1.0 + (b.y / 100.0) * w;
    lch.x *= 1.0 + (b.z / 100.0) * w * 0.8;
  }
  return max(oklabToLinear(oklchToOklab(lch)), vec3(0.0));
}

vec3 applyGrading(vec3 c) {
  vec3 lab = linearToOklab(max(c, vec3(0.0)));
  float e = encP(luma2020(c));
  float blend = uGradeBlend.x;
  float balance = uGradeBlend.y * 0.15;
  float wS = (1.0 - smoothstep(0.0, 0.62 + balance, e)) * blend;
  float wH = smoothstep(0.38 + balance, 1.0, e) * blend;
  float wM = max(0.0, 1.0 - wS - wH) * blend;
  vec2 sh = vec2(cos(uGradeShadow.x * TAU), sin(uGradeShadow.x * TAU)) * uGradeShadow.y * wS;
  vec2 md = vec2(cos(uGradeMid.x * TAU), sin(uGradeMid.x * TAU)) * uGradeMid.y * wM;
  vec2 hi = vec2(cos(uGradeHigh.x * TAU), sin(uGradeHigh.x * TAU)) * uGradeHigh.y * wH;
  vec2 gl = vec2(cos(uGradeGlobal.x * TAU), sin(uGradeGlobal.x * TAU)) * uGradeGlobal.y;
  lab.gb += (sh + md + hi + gl) * 0.34;
  lab.r += (uGradeShadow.z * wS + uGradeMid.z * wM + uGradeHigh.z * wH + uGradeGlobal.z) * 0.0024;
  return max(oklabToLinear(lab), vec3(0.0));
}

vec3 applyDetail(vec3 c, vec2 uv) {
  vec3 small = texture(uBlurSmall, uv).rgb;
  float y = luma2020(c);
  float ys = luma2020(small);
  float edge = abs(y - ys);

  float nr = uNoise.x / 100.0;
  if (nr > 0.001) {
    float keep = 1.0 - nr * 0.85 * (1.0 - smoothstep(0.0, 0.05 + (uNoise.y / 100.0) * 0.13, edge));
    c = scaleLuma(c, max(mix(ys, y, clamp(keep, 0.0, 1.0)), 0.0));
    float cnr = uNoise.w / 100.0;
    if (cnr > 0.001) {
      vec3 lab = linearToOklab(max(c, vec3(0.0)));
      vec3 labBlur = linearToOklab(max(small, vec3(0.0)));
      lab.gb = mix(lab.gb, labBlur.gb, cnr * 0.65 * (1.0 - smoothstep(0.02, 0.12, edge)));
      c = max(oklabToLinear(lab), vec3(0.0));
    }
  }

  float amt = uSharpen.x / 100.0;
  if (amt > 0.001) {
    float maskEdge = 1.0 - smoothstep(0.0, 0.02 + (uSharpen.w / 100.0) * 0.25, edge);
    float detail = (y - ys) * (0.6 + (uSharpen.z / 100.0) * 1.4);
    float w = uSharpen.w > 0.5 ? maskEdge : 1.0;
    c = scaleLuma(c, max(y + detail * amt * w, 0.0));
  }
  return c;
}

vec3 applyLayerAdjust(vec3 c, vec2 uv, int i) {
  vec4 a = uLayerAdjA[i];
  vec4 b = uLayerAdjB[i];
  vec4 cc = uLayerAdjC[i];
  vec4 d = uLayerAdjD[i];

  c = applyTone(c, a.x, a.y, a.z, a.w, b.x, b.y);
  float t = b.z / 100.0;
  float ti = b.w / 100.0;
  c *= vec3(1.0 + t * 0.30, 1.0 - ti * 0.16, 1.0 - t * 0.28);
  c = applyPresence(c, uv, cc.w, cc.z, d.x);
  c = applySaturation(c, cc.x, cc.y);
  if (d.y > 0.001) {
    float y = luma2020(c);
    c = scaleLuma(c, max(y + (y - luma2020(texture(uBlurSmall, uv).rgb)) * (d.y / 100.0) * 1.2, 0.0));
  }
  if (d.w > 0.001) {
    vec3 large = texture(uBlurLarge, uv).rgb;
    c = mix(c, c + large * 0.85, (d.w / 100.0) * 0.5);
  }
  if (d.z > 0.001) {
    float n = hash12(floor(uv * vec2(900.0, 600.0)) + float(i) * 3.7);
    c *= 1.0 + (n - 0.5) * (d.z / 100.0) * 0.4;
  }
  return max(c, vec3(0.0));
}

vec4 sampleImageLayer(sampler2D tex, vec2 uv, vec4 tr, vec4 tr2) {
  vec2 p = uv - tr.xy;
  float cs = cos(tr.w), sn = sin(tr.w);
  p = vec2(p.x * cs + p.y * sn, -p.x * sn + p.y * cs);
  p /= max(tr.z, 1e-3);
  p.x /= max(tr2.x, 1e-3);
  if (tr2.y > 0.5) p.x = -p.x;
  if (tr2.z > 0.5) p.y = -p.y;
  p += 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0);
  vec4 t = texture(tex, p);
  return vec4(max(M_SRGB_TO_2020 * srgbToLinear(t.rgb), vec3(0.0)), t.a);
}

void main() {
  vec2 uv = vUv;

  /* geometry: upright / perspective / manual transform */
  vec3 hp = uGeometry * vec3(uv - 0.5, 1.0);
  uv = clamp(hp.xy / max(hp.z, 1e-4) + 0.5, vec2(-0.5), vec2(1.5));

  /* lens distortion + chromatic aberration */
  vec3 c;
  if (uLensEnabled == 1 && abs(uLens.x) > 0.001) {
    vec2 cc = uv - 0.5;
    float r2 = dot(cc, cc);
    uv = cc * (1.0 + (uLens.x / 100.0) * r2 * 1.35) + 0.5;
  }
  if (uLensEnabled == 1 && abs(uLens.y) > 0.001) {
    vec2 cc = uv - 0.5;
    float ca = (uLens.y / 100.0) * 0.0035;
    float r2 = dot(cc, cc);
    vec3 sr = texture(uSrc, clamp(cc * (1.0 + ca * (0.4 + r2 * 2.0)) + 0.5, vec2(0.0), vec2(1.0))).rgb;
    vec3 sg = texture(uSrc, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
    vec3 sb = texture(uSrc, clamp(cc * (1.0 - ca * (0.4 + r2 * 2.0)) + 0.5, vec2(0.0), vec2(1.0))).rgb;
    c = vec3(sr.r, sg.g, sb.b);
  } else {
    c = texture(uSrc, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  }

  /* white balance, calibration, profile amount */
  c = uCalibration * max(c * uWbGain, vec3(0.0));
  c = max(c, vec3(0.0));
  if (uProfileAmount < 0.995) {
    float y = luma2020(c);
    c = mix(vec3(y), c, clamp(uProfileAmount, 0.0, 1.0) * 0.4 + 0.6);
  }

  /* global tone */
  c = applyTone(c, uExposure, uContrast, uHighlights, uShadows, uWhites, uBlacks);

  /* curves: luma ratio first, then per-channel */
  {
    float y = luma2020(c);
    float e = encP(y);
    float e2 = mix(e, lutLuma(e), clamp(uCurveAmount, 0.0, 2.0));
    float y2 = max(decP(e2), 0.0);
    c = scaleLuma(c, y2);

    if (uHasRgbCurve == 1) {
      vec3 cur = vec3(
        lutRgb(encP(c.r), 0).r,
        lutRgb(encP(c.g), 1).g,
        lutRgb(encP(c.b), 2).b
      );
      vec3 lin = vec3(decP(cur.r), decP(cur.g), decP(cur.b));
      lin = mix(vec3(encP(c.r), encP(c.g), encP(c.b)), lin, clamp(uCurveAmount, 0.0, 2.0));
      lin = vec3(decP(lin.r), decP(lin.g), decP(lin.b));
      if (uLockLuminosity == 1) lin = scaleLuma(max(lin, vec3(0.0)), y2);
      c = max(lin, vec3(0.0));
    }
  }

  if (uHasHueCurve == 1) c = applyHueCurves(c);

  /* colour mixer / point colour / B&W treatment */
  if (uTreatment == 1) {
    vec3 lch = oklabToOklch(linearToOklab(max(c, vec3(0.0))));
    float dl = 1.0;
    for (int ch = 0; ch < 8; ch++) {
      float w = channelWeight(lch.z, ch);
      dl *= 1.0 + (uMixerL[ch] / 100.0) * w * 0.95;
    }
    lch.y = 0.0;
    lch.x *= clamp(dl, 0.0, 3.0);
    c = max(oklabToLinear(oklchToOklab(lch)), vec3(0.0));
  } else {
    c = applyMixer(c);
    c = applyPointColor(c);
  }

  c = applyGrading(c);
  c = applyPresence(c, uv, uTexture, uClarity, uDehaze);
  c = applySaturation(c, uVibrance, uSaturation);
  c = applyDetail(c, uv);

  /* creative 3-D LUT (.cube) — sampled in display-referred space */
  if (uHasLut3d == 1) {
    vec3 disp = clamp(linearToSrgb(max(c, vec3(0.0))), 0.0, 1.0);
    c = max(srgbToLinear(texture(uLut3d, clamp(disp, 0.0, 1.0) * 0.984 + 0.008).rgb), vec3(0.0));
  }

  /* layers */
  for (int i = 0; i < LAYERS; i++) {
    if (i >= uLayerCount) break;
    vec4 op = uLayerOp[i];
    if (op.x <= 0.001) continue;
    float mask = op.z > 0.5
      ? texture(uMaskAtlas, vec2((float(i) + uv.x) / float(LAYERS), uv.y)).r
      : 1.0;
    float opacity = clamp(op.x * mask, 0.0, 1.0);
    if (opacity <= 0.001) continue;

    vec3 blended;
    int kind = int(op.w);
    if (kind == 1 && uHasImage0 == 1) {
      vec4 img = sampleImageLayer(uImage0, uv, uLayerImg[0], uLayerImg2[0]);
      blended = mix(c, img.rgb, clamp(img.a * uLayerImg2[0].w, 0.0, 1.0));
    } else if (kind == 2 && uHasImage1 == 1) {
      vec4 img = sampleImageLayer(uImage1, uv, uLayerImg[1], uLayerImg2[1]);
      blended = mix(c, img.rgb, clamp(img.a * uLayerImg2[1].w, 0.0, 1.0));
    } else if (kind == 3) {
      vec4 f = uFillLayer[i];
      vec4 f2 = uFillLayer2[i];
      if (f.w < 1.5) blended = f.rgb;
      else if (f.w < 2.5) {
        float ang = f2.w * PI / 180.0;
        float t = clamp(dot(uv - 0.5, vec2(cos(ang), sin(ang))) * 1.6 + 0.5, 0.0, 1.0);
        blended = mix(f.rgb, f2.rgb, t);
      } else {
        blended = f.rgb * (0.4 + hash12(floor(uv * 700.0) + float(i) * 5.1) * 0.6);
      }
    } else {
      blended = applyLayerAdjust(c, uv, i);
    }
    c = blendMode(int(op.y), c, max(blended, vec3(0.0)), opacity);
  }

  /* effects */
  {
    float amount = uVignette.x / 100.0;
    if (abs(amount) > 0.001) {
      vec2 p = (uv - 0.5) * vec2(1.0, 1.0 + uVignette.z / 220.0);
      float d = length(p) * 1.44;
      float mid = clamp(uVignette.y / 100.0, 0.02, 0.98);
      float feather = max(uVignette.w / 100.0, 0.05);
      float v = smoothstep(mid + feather, mid - feather, d);
      float y = luma2020(c);
      float protect = mix(1.0, smoothstep(0.35, 0.95, y), (uVignette2.y / 100.0) * step(0.5, uVignette2.x));
      c *= mix(1.0, mix(1.0 - amount * 0.95, 1.0 + amount * 0.35, v), protect);
      c = max(c, vec3(0.0));
    }
    if (uGrain.x > 0.001) {
      float size = max(uGrain.y, 1.0);
      float n = hash12(floor(uv * vec2(1600.0, 1200.0) / size) + uGrain.z * 17.0);
      float y = luma2020(c);
      float w = max(1.0 - abs(y - 0.45) * 1.3, 0.15);
      c *= 1.0 + (n - 0.5) * (uGrain.x / 100.0) * 0.6 * w;
      c = max(c, vec3(0.0));
    }
  }

  /* cutout alpha for background replacement (§4.7) */
  float alpha = 1.0;
  if (uCutoutEnabled == 1) {
    float a = texture(uCutout, clamp(uv, vec2(0.0), vec2(1.0))).r;
    alpha = mix(a, 1.0 - a, uCutoutInvert);
  }

  /* soft proof: matrix to the proof space + paper simulation */
  if (uProofEnabled == 1) {
    c = max(uProofMatrix * c, vec3(0.0));
    c = mix(c, c * 0.96 + vec3(0.035), uProofPaper);
  }

  oColor = vec4(max(c, vec3(0.0)), alpha);
}
`);

/* ----------------------------------------------------------------- output */

export const OUTPUT_FRAG = frag(/* glsl */ `
uniform sampler2D uTex;          // working-space RGBA16F (alpha = cutout)
uniform sampler2D uBefore;       // second buffer for before/after
uniform sampler2D uBgImage;      // background plate
uniform vec4 uCrop;              // x, y, w, h in 0..1 of the source
uniform vec2 uView;              // visible rect origin, inside the crop (0..1)
uniform vec2 uViewSize;          // visible rect size (1/zoom)
uniform float uCropAspect;       // (cropW * srcW) / (cropH * srcH)
uniform float uRotate;           // crop angle, radians
uniform int uFlipH;
uniform int uFlipV;
uniform int uBeforeAfterMode;    // 0 off, 1 split, 2 left/right, 3 top/bottom, 4 toggle
uniform float uSplit;
uniform int uUseBeforeBuffer;
uniform vec2 uDstSize;
uniform vec3 uBackdrop;
uniform int uTransparent;
uniform vec4 uBg;                // kind: 0 none,1 checker,2 solid,3 gradient,4 blur,5 studioGray,6 whiteSweep,7 image
uniform vec3 uBgColor;
uniform vec3 uBgColor2;
uniform float uBgAngle;
uniform float uBgBlur;
uniform int uClippingMode;       // 0 off, 1 both, 2 highlights, 3 shadows
uniform float uGamutWarn;
uniform float uSharpnessHeat;
uniform float uMaskOverlay;      // 0 off, 1 on
uniform vec3 uMaskColor;
uniform float uMaskMode;         // 0 colour, 1 bw, 2 onBlack, 3 onWhite
uniform sampler2D uMaskTile;     // active layer mask, full tile
uniform mat3 uDisplayMatrix;     // working space -> display (soft proof aware)

out vec4 oColor;

vec3 toDisplay(vec3 c) {
  return clamp(linearToSrgb(max(uDisplayMatrix * c, vec3(0.0))), 0.0, 1.0);
}

vec2 mapUv(vec2 suv) {
  // canvas (image space, y down) → cropped-frame → source texture coords
  vec2 p = uView + suv * uViewSize;         // 0..1 inside the crop rect
  vec2 rel = p - 0.5;
  rel.x *= uCropAspect;
  float cs = cos(uRotate), sn = sin(uRotate);
  rel = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
  rel.x /= max(uCropAspect, 1e-4);
  vec2 src = uCrop.xy + (rel + 0.5) * uCrop.zw;
  if (uFlipH == 1) src.x = uCrop.x + uCrop.z - (src.x - uCrop.x);
  if (uFlipV == 1) src.y = uCrop.y + uCrop.w - (src.y - uCrop.y);
  return src;
}

void main() {
  vec2 suv = vec2(vUv.x, 1.0 - vUv.y);   // image space, y down
  vec2 uv = mapUv(suv);
  bool outside = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
  vec2 cuv = clamp(uv, vec2(0.0), vec2(1.0));

  bool showBefore = false;
  if (uBeforeAfterMode == 1) showBefore = suv.x < uSplit;
  else if (uBeforeAfterMode == 2) showBefore = suv.x < 0.5;
  else if (uBeforeAfterMode == 3) showBefore = suv.y < 0.5;
  else if (uBeforeAfterMode == 4) showBefore = true;

  vec4 texel = texture(uTex, cuv);
  if (showBefore && uUseBeforeBuffer == 1) texel = texture(uBefore, cuv);
  vec3 c = texel.rgb;
  float alpha = texel.a;

  int bgKind = int(uBg.x);
  vec3 disp;
  float outAlpha = 1.0;

  if (outside) {
    disp = uBackdrop;
    outAlpha = uTransparent == 1 ? 0.0 : 1.0;
  } else {
    disp = toDisplay(c);
    outAlpha = uTransparent == 1 ? alpha : 1.0;

    /* background replacement */
    if (bgKind > 0) {
      vec3 bg = vec3(0.0);
      float bgAlpha = 1.0;
      if (bgKind == 1) {
        vec2 g = floor(suv * uDstSize / 11.0);
        bg = mix(vec3(0.20), vec3(0.28), mod(g.x + g.y, 2.0));
        bgAlpha = 0.0;
      } else if (bgKind == 2) bg = uBgColor;
      else if (bgKind == 3) {
        float a = uBgAngle * PI / 180.0;
        float t = clamp(dot(suv - 0.5, vec2(cos(a), sin(a))) * 1.4 + 0.5, 0.0, 1.0);
        bg = mix(uBgColor, uBgColor2, t);
      } else if (bgKind == 4) {
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        float rad = uBgBlur * 0.012;
        for (int i = 0; i < 10; i++) {
          float ang = float(i) * TAU / 10.0;
          for (int j = 1; j <= 3; j++) {
            vec2 o = vec2(cos(ang), sin(ang)) * rad * float(j);
            float w = 1.0 / float(j);
            acc += texture(uTex, clamp(cuv + o, vec2(0.0), vec2(1.0))).rgb * w;
            wsum += w;
          }
        }
        bg = toDisplay(acc / max(wsum, 1.0));
      } else if (bgKind == 5) {
        float t = clamp(suv.y * 1.25 - 0.12, 0.0, 1.0);
        bg = mix(vec3(0.40), vec3(0.66), t * t);
      } else if (bgKind == 6) {
        float t = clamp(suv.y * 1.2, 0.0, 1.0);
        bg = mix(vec3(0.84), vec3(1.0), t * t);
      } else if (bgKind == 7) {
        bg = texture(uBgImage, suv).rgb;
      }
      disp = mix(bg, disp, clamp(alpha, 0.0, 1.0));
      outAlpha = uTransparent == 1 ? max(alpha, bgAlpha * (1.0 - alpha)) : 1.0;
    }

    /* clipping indicators — filled, colour-blind-safe */
    if (uClippingMode > 0) {
      float hi = float(c.r > 1.0 || c.g > 1.0 || c.b > 1.0);
      float lo = float(c.r <= 0.0009 || c.g <= 0.0009 || c.b <= 0.0009);
      if ((uClippingMode == 1 || uClippingMode == 2) && hi > 0.5) disp = vec3(0.96, 0.22, 0.30);
      if ((uClippingMode == 1 || uClippingMode == 3) && lo > 0.5) disp = vec3(0.22, 0.48, 0.99);
    }

    /* out-of-gamut warning (soft proof) */
    if (uGamutWarn > 0.5) {
      vec3 proof = uDisplayMatrix * c;
      float oog = float(proof.r < -0.002 || proof.g < -0.002 || proof.b < -0.002 ||
                        proof.r > 1.002 || proof.g > 1.002 || proof.b > 1.002);
      disp = mix(disp, vec3(0.98, 0.40, 0.86), oog * 0.9);
    }

    /* focus peaking / sharpness heatmap */
    if (uSharpnessHeat > 0.5) {
      vec2 t = vec2(1.0 / max(uDstSize.x, 1.0), 1.0 / max(uDstSize.y, 1.0));
      float y = luma2020(c);
      float n = luma2020(texture(uTex, cuv + vec2(t.x, 0.0)).rgb);
      float s = luma2020(texture(uTex, cuv - vec2(t.x, 0.0)).rgb);
      float e = luma2020(texture(uTex, cuv + vec2(0.0, t.y)).rgb);
      float w = luma2020(texture(uTex, cuv - vec2(0.0, t.y)).rgb);
      float lap = abs(4.0 * y - n - s - e - w);
      disp = mix(disp, vec3(0.30, 0.95, 0.62), smoothstep(0.030, 0.150, lap) * 0.8);
    }

    /* mask overlay for the active layer */
    if (uMaskOverlay > 0.5) {
      float m = texture(uMaskTile, cuv).r;
      if (uMaskMode < 0.5) disp = mix(disp, uMaskColor, m * 0.72);
      else if (uMaskMode < 1.5) disp = mix(disp, vec3(m), 0.9);
      else if (uMaskMode < 2.5) disp = vec3(m);
      else disp = vec3(1.0 - m);
    }
  }

  oColor = vec4(disp, outAlpha);
}
`);

/* ------------------------------------------------------------- linearise */

/**
 * Source (8-bit sRGB, as decoded) → linear Rec.2020 working space.
 * Kept as its own pass so every downstream pass can assume the working space.
 */
export const LINEARIZE_FRAG = frag(/* glsl */ `
uniform sampler2D uTex;
out vec4 oColor;
void main() {
  vec3 srgb = texture(uTex, vUv).rgb;
  oColor = vec4(max(M_SRGB_TO_2020 * srgbToLinear(srgb), vec3(0.0)), 1.0);
}
`);
