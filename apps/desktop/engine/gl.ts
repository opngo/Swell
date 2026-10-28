/**
 * WebGL2 helpers: context, programs, textures, framebuffers and a size-classed
 * texture pool (§6.2 "reuse GPU textures/framebuffers by size class").
 */

export type GL = WebGL2RenderingContext;

export class GLError extends Error {
  constructor(
    message: string,
    readonly stage: 'compile' | 'link' | 'runtime',
    readonly program?: string,
  ) {
    super(message);
    this.name = 'GLError';
  }
}

export function compileShader(gl: GL, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new GLError('createShader failed', 'compile', label);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new GLError(`${label}: ${annotate(src, log)}`, 'compile', label);
  }
  return sh;
}

/** Prefix GLSL compile errors with the offending source lines. */
export function annotate(src: string, log: string): string {
  const m = log.match(/ERROR:\s*\d+:(\d+):/);
  if (!m) return log;
  const line = parseInt(m[1]!, 10);
  const lines = src.split('\n');
  const from = Math.max(0, line - 3);
  const to = Math.min(lines.length, line + 2);
  const ctx = lines
    .slice(from, to)
    .map((l, i) => `${from + i + 1 === line ? '»' : ' '} ${from + i + 1}: ${l}`)
    .join('\n');
  return `${log}\n${ctx}`;
}

export type UniformInfo = {
  loc: WebGLUniformLocation | null;
  type: number;
  size: number;
  name: string;
};

export type Program = {
  program: WebGLProgram;
  uniforms: Map<string, UniformInfo>;
  use: () => void;
  loc: (name: string) => WebGLUniformLocation | null;
};

export function createProgram(gl: GL, vertSrc: string, fragSrc: string, label: string): Program {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc, `${label}.frag`);
  const p = gl.createProgram();
  if (!p) throw new GLError('createProgram failed', 'link', label);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '';
    gl.deleteProgram(p);
    throw new GLError(`${label} link: ${log}`, 'link', label);
  }
  const uniforms = new Map<string, UniformInfo>();
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    // array uniforms are reported as "name[0]"
    const name = info.name.replace(/\[0\]$/, '');
    uniforms.set(name, { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size, name });
  }
  return {
    program: p,
    uniforms,
    use: () => gl.useProgram(p),
    loc: (name: string) => uniforms.get(name)?.loc ?? null,
  };
}

export type UniformValue = number | number[] | Float32Array | Int32Array;

const toFloat = (v: UniformValue): Float32Array =>
  v instanceof Float32Array ? v : Array.isArray(v) ? Float32Array.from(v) : Float32Array.from([v]);

const toInt = (v: UniformValue): Int32Array =>
  v instanceof Int32Array
    ? v
    : typeof v === 'number'
      ? Int32Array.from([v])
      : Int32Array.from(Array.isArray(v) ? v : Array.from(v));

/**
 * Uniforms are set from their **declared GLSL type**, so a `float uMixerH[8]`
 * is never mistaken for two vec4s. Optimised-out uniforms are ignored.
 */
export function setUniforms(gl: GL, prog: Program, values: Record<string, UniformValue>): void {
  for (const name in values) {
    const info = prog.uniforms.get(name);
    if (!info || !info.loc) continue;
    const v = values[name]!;
    switch (info.type) {
      case gl.FLOAT:
        gl.uniform1fv(info.loc, toFloat(v));
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(info.loc, toFloat(v));
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(info.loc, toFloat(v));
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(info.loc, toFloat(v));
        break;
      case gl.INT:
      case gl.BOOL:
      case gl.SAMPLER_2D:
      case gl.SAMPLER_3D:
      case gl.SAMPLER_CUBE:
      case gl.INT_SAMPLER_2D:
      case gl.UNSIGNED_INT_SAMPLER_2D:
        gl.uniform1iv(info.loc, toInt(v));
        break;
      case gl.FLOAT_MAT3:
        gl.uniformMatrix3fv(info.loc, false, toFloat(v));
        break;
      case gl.FLOAT_MAT4:
        gl.uniformMatrix4fv(info.loc, false, toFloat(v));
        break;
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------- textures */

export type TexSpec = {
  w: number;
  h: number;
  internal: number;
  format: number;
  type: number;
  filter: number;
  wrap: number;
};

export class GpuTexture {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer | null = null;
  bytes: number;

  constructor(
    readonly gl: GL,
    readonly spec: TexSpec,
  ) {
    const t = gl.createTexture();
    if (!t) throw new GLError('createTexture failed', 'runtime');
    this.texture = t;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, spec.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, spec.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, spec.wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, spec.wrap);
    gl.texStorage2D(gl.TEXTURE_2D, 1, spec.internal, spec.w, spec.h);
    this.bytes = spec.w * spec.h * bytesPerPixel(spec.internal);
  }

  get width(): number {
    return this.spec.w;
  }
  get height(): number {
    return this.spec.h;
  }

  attachFbo(): WebGLFramebuffer {
    const { gl } = this;
    if (!this.fbo) {
      const f = gl.createFramebuffer();
      if (!f) throw new GLError('createFramebuffer failed', 'runtime');
      this.fbo = f;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new GLError(`Framebuffer incomplete: 0x${status.toString(16)}`, 'runtime');
    }
    return this.fbo;
  }

  upload(
    data: ArrayBufferView | ImageBitmap | HTMLImageElement | null,
    opts: { flipY?: boolean; alignment?: number } = {},
  ): void {
    const { gl, spec } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, opts.alignment ?? 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opts.flipY ? 1 : 0);
    if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, spec.format, spec.type, data as TexImageSource);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  }

  destroy(): void {
    const { gl } = this;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.texture);
    this.fbo = null;
  }
}

export function bytesPerPixel(internal: number): number {
  switch (internal) {
    case 0x8229: // RGBA16F
    case 0x881a: // RGBA16
      return 8;
    case 0x822a: // RG16F
      return 4;
    case 0x822d: // R16F
      return 2;
    case 0x8227: // R8
      return 1;
    default: // RGBA8 and friends
      return 4;
  }
}

/** Size-classed pool: allocations are exact but freed textures are recycled. */
export class TexturePool {
  private free = new Map<string, GpuTexture[]>();
  private live = 0;
  private liveBytes = 0;
  private disposedBytes = 0;

  constructor(
    private gl: GL,
    private halfFloat: boolean,
  ) {}

  private key(spec: TexSpec): string {
    return `${spec.w}x${spec.h}x${spec.internal}x${spec.filter}`;
  }

  acquire(spec: TexSpec): GpuTexture {
    const k = this.key(spec);
    const tex = this.free.get(k)?.pop();
    const t = tex ?? new GpuTexture(this.gl, spec);
    this.live++;
    this.liveBytes += t.bytes;
    return t;
  }

  release(tex: GpuTexture): void {
    const k = this.key(tex.spec);
    const bucket = this.free.get(k) ?? [];
    bucket.push(tex);
    this.free.set(k, bucket);
    this.live--;
    this.liveBytes -= tex.bytes;
  }

  /** Explicitly destroy() pooled textures — required to actually free VRAM. */
  evict(bytesTarget = 0): number {
    let freed = 0;
    for (const [k, bucket] of [...this.free]) {
      while (bucket.length && (bytesTarget === 0 || freed < bytesTarget)) {
        const t = bucket.pop()!;
        freed += t.bytes;
        t.destroy();
      }
      if (!bucket.length) this.free.delete(k);
    }
    this.disposedBytes += freed;
    return freed;
  }

  stats(): {
    live: number;
    liveBytes: number;
    pooled: number;
    pooledBytes: number;
    disposedBytes: number;
    halfFloat: boolean;
  } {
    let pooled = 0,
      pooledBytes = 0;
    for (const bucket of this.free.values()) {
      for (const t of bucket) {
        pooled++;
        pooledBytes += t.bytes;
      }
    }
    return {
      live: this.live,
      liveBytes: this.liveBytes,
      pooled,
      pooledBytes,
      disposedBytes: this.disposedBytes,
      halfFloat: this.halfFloat,
    };
  }
}

export function supportsHalfFloatRender(gl: GL): boolean {
  return !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
}

export function createTexture3D(gl: GL, size: number, data: Uint8Array): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return tex;
}

/** Bind a texture to a unit and return the unit index. */
export function bind(gl: GL, unit: number, tex: WebGLTexture | null, target: GLenum = gl.TEXTURE_2D): number {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, tex);
  return unit;
}

export function maxTextureSize(gl: GL): number {
  return gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
}

export function maxFragmentUniformVectors(gl: GL): number {
  return gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
}
