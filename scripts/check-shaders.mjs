#!/usr/bin/env node
/**
 * Shader syntax gate.
 *
 * There is no GLSL compiler in CI, and a broken shader only shows up as a black
 * canvas at runtime. So every program exported from `@swell/shaders` is run
 * through the ShaderFrog GLSL ES 3.0 parser: preprocessor first (`#define`,
 * `#ifdef`), then the grammar. This catches syntax errors, bad declarations and
 * unbalanced braces before anyone opens the app.
 *
 * It does *not* catch semantic errors (type mismatches, undeclared uniforms the
 * driver would reject) — `npm run test` covers the CPU side of the contract and
 * the runtime falls back to an unedited <img> if a program fails to link.
 *
 * Usage: node scripts/check-shaders.mjs
 */

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { preprocess, generate } = require('@shaderfrog/glsl-parser/preprocessor');
const { parse, GlslSyntaxError } = require('@shaderfrog/glsl-parser');

const outFile = resolve(root, 'node_modules/.cache/swell/shaders.mjs');
mkdirSync(dirname(outFile), { recursive: true });

await build({
  entryPoints: [resolve(root, 'packages/shaders/src/index.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
});

const mod = await import(`${pathToFileURL(outFile).href}?t=${Date.now()}`);

const programs = Object.entries(mod).filter(
  ([, v]) => typeof v === 'string' && v.includes('void main'),
);

if (!programs.length) {
  console.error('check-shaders: no GLSL programs found in @swell/shaders');
  process.exit(1);
}

let failures = 0;
for (const [name, src] of programs) {
  const lines = src.split('\n');
  let processed = src;
  try {
    processed = generate(preprocess(src));
    parse(processed, { quiet: true });
    console.log(`  ok   ${name.padEnd(18)} ${lines.length} lines`);
  } catch (err) {
    failures += 1;
    const e = err;
    const msg = String(e?.message ?? e);
    const m = /location:(\d+):(\d+)/.exec(msg);
    const ln = m ? Number(m[1]) : 0;
    const col = m ? Number(m[2]) : 0;
    console.error(`  FAIL ${name} line ${ln || '?'}, col ${col || '?'}`);
    console.error(`       ${msg.split('\n')[0].replace(/^Error: /, '')}`);
    if (ln > 0) {
      // the preprocessor preserves line numbers, so this points at the source
      const ls = processed.split('\n');
      for (let i = Math.max(0, ln - 3); i < Math.min(ls.length, ln + 2); i++) {
        const mark = i + 1 === ln ? '>' : ' ';
        console.error(`     ${mark}${String(i + 1).padStart(4)} | ${ls[i]}`);
      }
      const srcLine = lines.findIndex((l) => l.trim() === (ls[ln - 1] ?? '\u0000').trim());
      if (srcLine >= 0) console.error(`       (packages/shaders source line ${srcLine + 1})`);
    }
  }
}

function processedSafe(src, ln) {
  const l = src.split('\n')[ln - 1];
  return (l ?? '').trim().slice(0, 120);
}

console.log(
  failures
    ? `\ncheck-shaders: ${failures}/${programs.length} program(s) failed to parse`
    : `\ncheck-shaders: all ${programs.length} GLSL programs parse cleanly`,
);
process.exit(failures ? 1 : 0);
