#!/usr/bin/env node
/**
 * Borderless lint (§2.1, Appendix B).
 *
 * Swell separates surfaces with tonal elevation, spacing, shadow, blur, shape
 * and motion — never with a stroke. This is the enforcement the spec asks for.
 *
 * What it flags
 *   · Tailwind stroke utilities in class strings: `border*`, `divide-*`,
 *     `outline*`, `ring*`
 *   · CSS/styled declarations: `border: 1px solid …`, `outline: 1px …`
 *   · The sneaky equivalents: `box-shadow: inset 0 0 0 1px …` (a hairline drawn
 *     with a shadow) and `h-px`/`w-px` divider elements
 *
 * What it ignores
 *   · comments, GLSL (a variable called `ring` is not a ring utility)
 *   · JS identifiers (`const border = …`) — only quoted class/CSS strings count
 *   · resets that *remove* strokes: `border-0`, `border-none`, `outline-none`,
 *     `ring-0`, `border-width: 0`, `border-style: none`
 *   · shape: `border-radius`, `rounded-*`
 *   · any line carrying `borderless-allow: <reason>` — the sanctioned escape
 *     hatch for photo-content overlays (§2.1 allows the 1px luminance-adaptive
 *     guides drawn *inside* the photo, and the spinner arc, which is motion,
 *     not a surface divider)
 *
 * Usage: node scripts/check-borderless.mjs [--json]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['apps/desktop/src', 'apps/desktop/engine', 'apps/desktop/electron', 'packages'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'icons', 'shaders']);

/** A stroke utility, unless it is the reset that removes one (`-none`, `-0`). */
const NOT_RESET = '(?!-(?:none|0)\\b)';
const CLASS_RULES = [
  ['border utility', new RegExp(`\\bborder(?:-(?:t|r|b|l|x|y|s|e))?${NOT_RESET}\\b`, 'g')],
  ['divide utility', /\bdivide-(?:x|y)(?:-[\w/[\].-]+)*/g],
  ['outline utility', new RegExp(`\\boutline${NOT_RESET}\\b`, 'g')],
  ['ring utility', new RegExp(`\\bring(?:-(?:inset|offset(?:-\\w+)*|opacity-\\d+))?${NOT_RESET}\\b`, 'g')],
  ['1px divider element', /\b(?:h-px|w-px|h-\[1px\]|w-\[1px\]|min-h-\[1px\])\b/g],
  // a hairline drawn with an inset shadow is still a stroke
  ['inset hairline shadow', /inset[_\s]0[_\s]0[_\s]0[_\s](?:0?\.\d+|[1-9](?:\.\d+)?)(?:px|rem|em)/gi],
];

const CSS_RULES = [
  ['css border', /\bborder(?:-(?:top|right|bottom|left|block|inline))?\s*:\s*[^;}\n]*/gi],
  ['css outline', /\boutline\s*:\s*[^;}\n]*/gi],
  ['inset hairline shadow', /inset\s+0\s+0\s+0\s+(?:0?\.\d+|[1-9](?:\.\d+)?)(?:px|rem|em)/gi],
  // Tailwind arbitrary values use underscores: shadow-[inset_0_0_0_1px_#fff]
  ['inset hairline shadow', /inset_0_0_0_(?:0?\.\d+|[1-9](?:\.\d+)?)(?:px|rem|em)/gi],
];

/** Tokens that remove a stroke rather than add one. */
const RESET_TOKENS = /^(?:border-(?:0|none)|outline-(?:0|none)|ring-0)$/;
/** Shape, not strokes. */
const SHAPE_TOKENS = /^border-(?:radius|collapse|separate|spacing)/;
/** CSS declarations that are the global reset. */
const RESET_CSS = /:\s*['"]?\s*(?:0|none)\b/;

const ALLOW_MARKER = /borderless-allow:/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

/** Blank out comments, preserving line numbers and column offsets. */
function stripComments(src, isCss) {
  let out = '';
  let i = 0;
  let inString = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (!isCss && c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Quoted spans of a line: class lists, inline style strings, CSS values. */
function quotedSpans(line) {
  const spans = [];
  const re = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;
  let m;
  while ((m = re.exec(line))) spans.push(m[0].slice(1, -1));
  return spans;
}

const files = SCAN_ROOTS.flatMap((d) => {
  const abs = join(root, d);
  try {
    statSync(abs);
  } catch {
    return [];
  }
  return walk(abs);
});

const violations = [];

for (const file of files) {
  const rel = relative(root, file);
  const isCss = extname(file) === '.css';
  const src = stripComments(readFileSync(file, 'utf8'), isCss);
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    if (ALLOW_MARKER.test(line)) return;
    const report = (label, token, snippet) =>
      violations.push({ file: rel, line: i + 1, label, token, text: snippet.trim().slice(0, 150) });

    if (isCss) {
      for (const [label, re] of CSS_RULES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          if (RESET_CSS.test(m[0])) continue;
          if (/border-radius/i.test(m[0])) continue;
          report(label, m[0].trim(), line);
        }
      }
      return;
    }

    // JSX style objects put the property outside the quoted value, so scan the
    // whole line when it is clearly a style declaration.
    if (/style=\{\{|\bcss\s*[:=]|styled[.(]/.test(line)) {
      for (const [label, re] of CSS_RULES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          if (RESET_CSS.test(m[0])) continue;
          report(label, m[0].trim(), line);
        }
      }
    }

    // TS/TSX: only look inside string literals, so identifiers never match.
    const spans = quotedSpans(line);
    if (!spans.length) return;
    for (const span of spans) {
      // `style="…"` / CSS-in-JS strings hold declarations, not class names
      const looksCss = /^[\w-]+\s*:[^;]*;/.test(span.trim()) || /;\s*[\w-]+\s*:/.test(span);
      if (looksCss) {
        for (const [label, re] of CSS_RULES) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(span))) {
            if (RESET_CSS.test(m[0])) continue;
            report(label, m[0].trim(), line);
          }
        }
        continue;
      }
      // Prose is not a class list. Labels, toasts and test names are quoted too,
      // and a real Tailwind list of three or more utilities nearly always carries
      // a hyphen, a variant colon or an arbitrary value — a hyphen-free sentence
      // of that length is copy, so it is skipped.
      if (span.trim().split(/\s+/).length >= 3 && !/[-:[/]/.test(span)) continue;
      for (const [label, re] of CLASS_RULES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(span))) {
          const token = m[0];
          if (RESET_TOKENS.test(token) || SHAPE_TOKENS.test(token)) continue;
          report(label, token, line);
        }
      }
    }
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(violations, null, 2));
  process.exit(violations.length ? 1 : 0);
}

if (violations.length) {
  console.error(`borderless: ${violations.length} violation(s) across ${files.length} scanned files\n`);
  let last = '';
  for (const v of violations) {
    if (v.file !== last) {
      console.error(`  ${v.file}`);
      last = v.file;
    }
    console.error(`    ${String(v.line).padStart(5)}  [${v.label}] ${v.token}`);
    console.error(`           ${v.text}`);
  }
  console.error('\n  Separate with elevation (--s0…--s5), spacing, shadow (--e1…--e3), blur,');
  console.error('  shape and motion — never a stroke. Sanctioned exceptions (photo-content');
  console.error('  overlays) take a `borderless-allow: <reason>` marker on the same line.\n');
  process.exit(1);
}

console.log(`borderless: clean — 0 strokes across ${files.length} files`);
