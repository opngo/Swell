import { useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { cx } from '@/ui/cx.ts';
import { SwIcon } from '@/ui/icons.tsx';
import { Button, Chip, IconButton, Badge } from '@/ui/Button.tsx';
import { Section } from '@/ui/Panel.tsx';
import { SegmentedControl, Select } from '@/ui/Controls.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { Histogram } from '@/ui/Histogram.tsx';
import {
  ParamSlider,
  ParamSwitch,
  ParamSelect,
  GroupHead,
  useLive,
  writeLive,
  commitLive,
  replaceLive,
} from './ParamControls.tsx';
import { editorStore, histogramAtom, patchToolAtom, toolAtom } from '@/state/atoms.ts';
import { useDevelop } from '@/state/develop.ts';
import { useCatalog } from '@/state/catalog.ts';
import { BUILTIN_PROFILES, PROFILE_GROUPS } from '@/lib/builtinPresets.ts';
import { MIXER_CHANNELS, type MixerChannel } from '@swell/schema';
import { formatExposure, formatKelvin } from '@swell/shared';

/* ========================================================================== */
/*  LIGHT                                                                      */
/* ========================================================================== */

export function LightPanel() {
  const params = useLive();
  const profiles = useDevelop((s) => s.profiles);
  const applyProfile = useDevelop((s) => s.applyProfile);
  const photoId = useCatalog((s) => s.activeId());
  const histogram = useAtomValue(histogramAtom);

  const profileOptions = useMemo(
    () =>
      PROFILE_GROUPS.flatMap((g) =>
        profiles.filter((p) => p.group === g.id).map((p) => ({ value: p.id, label: p.name, hint: g.label })),
      ),
    [profiles],
  );

  return (
    <div className="flex flex-col gap-1 pb-6">
      <div className="px-1.5 pt-1.5">
        <Histogram data={histogram} height={72} compact />
      </div>

      <Section title="Profile" icon="palette" dense>
        <div className="flex items-center gap-2 px-1">
          <Select
            size="sm"
            className="flex-1"
            ariaLabel="Camera profile"
            value={params.profile.id}
            options={profileOptions}
            onChange={(v) => {
              if (photoId) applyProfile(photoId, v);
              else writeLive('profile.id', v);
            }}
          />
        </div>
        <ParamSlider
          path="profile.amount"
          label="Amount"
          min={0}
          max={200}
          step={1}
          unit="%"
          format={(v) => `${Math.round(v)}%`}
        />
        <ParamSelect
          path="treatment"
          label="Treatment"
          options={[
            { value: 'color', label: 'Colour' },
            { value: 'bw', label: 'Black & White' },
          ]}
        />
      </Section>

      <Section title="White balance" icon="sun" dense>
        <ParamSelect
          path="wb.mode"
          label="Mode"
          options={[
            { value: 'asShot', label: 'As shot' },
            { value: 'auto', label: 'Auto' },
            { value: 'daylight', label: 'Daylight' },
            { value: 'cloudy', label: 'Cloudy' },
            { value: 'shade', label: 'Shade' },
            { value: 'tungsten', label: 'Tungsten' },
            { value: 'fluorescent', label: 'Fluorescent' },
            { value: 'flash', label: 'Flash' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <ParamSlider
          path="wb.temp"
          label="Temp"
          min={2000}
          max={50000}
          step={50}
          format={(v) => formatKelvin(v)}
          trackStyle={{
            background: 'linear-gradient(to right, #4a7fd4, #d8d8d8 45%, #f0b46a 70%, #e08a3c)',
          }}
        />
        <ParamSlider
          path="wb.tint"
          label="Tint"
          min={-150}
          max={150}
          step={1}
          trackStyle={{ background: 'linear-gradient(to right, #58a05c, #d8d8d8, #c65c9a)' }}
        />
        <div className="flex items-center gap-1 px-1 pt-1">
          <Button
            size="xs"
            icon="eyedropper"
            onClick={() => editorStore.set(patchToolAtom, { tool: 'eyedropper' })}
          >
            Sample from photo
          </Button>
          <span className="text-2xs text-t3">W</span>
        </div>
      </Section>

      <Section title="Tone" icon="histogram" dense right={<AutoToneButton />}>
        <ParamSlider
          path="tone.exposure"
          label="Exposure"
          min={-5}
          max={5}
          step={0.01}
          format={formatExposure}
          valueText={(v) => `${formatExposure(v)} exposure`}
          hint="EV"
        />
        <ParamSlider path="tone.contrast" label="Contrast" min={-100} max={100} step={1} />
        <ParamSlider path="tone.highlights" label="Highlights" min={-100} max={100} step={1} />
        <ParamSlider path="tone.shadows" label="Shadows" min={-100} max={100} step={1} />
        <ParamSlider path="tone.whites" label="Whites" min={-100} max={100} step={1} />
        <ParamSlider path="tone.blacks" label="Blacks" min={-100} max={100} step={1} />
      </Section>

      <Section title="Presence" icon="sparks" dense>
        <ParamSlider path="presence.texture" label="Texture" min={-100} max={100} step={1} />
        <ParamSlider path="presence.clarity" label="Clarity" min={-100} max={100} step={1} />
        <ParamSlider path="presence.dehaze" label="Dehaze" min={-100} max={100} step={1} />
        <ParamSlider path="presence.vibrance" label="Vibrance" min={-100} max={100} step={1} />
        <ParamSlider path="presence.saturation" label="Saturation" min={-100} max={100} step={1} />
      </Section>

      <Section title="Calibration" icon="colourWheel" dense defaultOpen={false}>
        <ParamSelect
          path="calibration.profile"
          label="Camera profile"
          options={[
            { value: 'camera-standard', label: 'Standard' },
            { value: 'camera-neutral', label: 'Neutral' },
            { value: 'camera-vivid', label: 'Vivid' },
            { value: 'camera-portrait', label: 'Portrait' },
            { value: 'camera-landscape', label: 'Landscape' },
            { value: 'camera-flat', label: 'Flat' },
          ]}
        />
        <ParamSlider path="calibration.shadowsTint" label="Shadow tint" min={-100} max={100} step={1} />
        {(['red', 'green', 'blue'] as const).map((ch) => (
          <div key={ch}>
            <GroupHead title={ch} />
            <ParamSlider path={`calibration.${ch}.hue`} label="Hue" min={-100} max={100} step={1} />
            <ParamSlider path={`calibration.${ch}.sat`} label="Saturation" min={-100} max={100} step={1} />
          </div>
        ))}
      </Section>
    </div>
  );
}

/**
 * Auto tone: solve exposure so the histogram's centre of mass lands near a
 * target, then pull highlights/shadows to protect the extremes. Deterministic
 * and explainable — no model required.
 */
function AutoToneButton() {
  const histogram = useAtomValue(histogramAtom);
  const params = useLive();
  const [busy, setBusy] = useState(false);

  return (
    <Tooltip label="Auto tone (⇧⌘T)" placement="left">
      <span>
        <IconButton
          name="magic"
          size={13}
          box="sm"
          label="Auto tone"
          disabled={!histogram || busy}
          onClick={() => {
            if (!histogram) return;
            setBusy(true);
            const bins = histogram.luma.length;
            let sum = 0;
            let mass = 0;
            for (let i = 0; i < bins; i++) {
              const v = histogram.luma[i] ?? 0;
              sum += v * (i / (bins - 1));
              mass += v;
            }
            const com = mass > 0 ? sum / mass : 0.5;
            const target = 0.44;
            const exposureDelta = Math.max(-1.6, Math.min(1.6, (target - com) * 3.1));
            const highlights = Math.round(
              Math.max(-80, Math.min(0, -histogram.clippedHighlights * 900 - (com > 0.6 ? 18 : 6))),
            );
            const shadows = Math.round(Math.min(80, Math.max(0, histogram.clippedShadows * 700 + (com < 0.4 ? 20 : 8))));
            const blacks = Math.round(Math.max(-30, Math.min(6, (0.12 - com) * 26)));
            const whites = Math.round(Math.max(-10, Math.min(24, (0.86 - com) * 34)));
            const contrast = Math.round(Math.max(-10, Math.min(22, 6 + (0.5 - com) * 24)));

            const next = {
              ...params,
              tone: {
                ...params.tone,
                exposure: Number((params.tone.exposure + exposureDelta).toFixed(2)),
                highlights,
                shadows,
                whites,
                blacks,
                contrast,
              },
            };
            replaceLive(next);
            commitLive('Auto tone');
            setBusy(false);
          }}
        />
      </span>
    </Tooltip>
  );
}

/* ========================================================================== */
/*  COLOUR                                                                     */
/* ========================================================================== */

const MIXER_LABELS: Record<MixerChannel, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  aqua: 'Aqua',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
};

const MIXER_SWATCH: Record<MixerChannel, string> = {
  red: 'oklch(0.62 0.21 27)',
  orange: 'oklch(0.72 0.16 55)',
  yellow: 'oklch(0.85 0.16 95)',
  green: 'oklch(0.72 0.18 145)',
  aqua: 'oklch(0.76 0.12 195)',
  blue: 'oklch(0.6 0.19 255)',
  purple: 'oklch(0.58 0.2 300)',
  magenta: 'oklch(0.64 0.21 340)',
};

export function ColorPanel() {
  const params = useLive();
  const [channel, setChannel] = useState<MixerChannel>('orange');
  const [axis, setAxis] = useState<'h' | 's' | 'l'>('h');

  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="Colour mixer" icon="colourWheel" dense>
        <div className="px-1 pb-1">
          <SegmentedControl
            size="sm"
            ariaLabel="Mixer axis"
            value={axis}
            onChange={(v) => setAxis(v)}
            segments={[
              { value: 'h', label: 'Hue' },
              { value: 's', label: 'Sat' },
              { value: 'l', label: 'Lum' },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-1 px-1 pb-1.5">
          {MIXER_CHANNELS.map((c) => {
            const active = c === channel;
            const v = params.mixer[c]?.[axis] ?? 0;
            return (
              <Tooltip key={c} label={`${MIXER_LABELS[c]} · ${axis === 'h' ? 'hue' : axis === 's' ? 'saturation' : 'luminance'} ${v > 0 ? '+' : ''}${v}`} placement="top">
                <button
                  type="button"
                  onClick={() => setChannel(c)}
                  aria-pressed={active}
                  className={cx(
                    'relative grid size-7 place-items-center rounded-[var(--radius-sm)] transition-transform duration-[120ms] hover:scale-105',
                    active && 'ring-0 shadow-[var(--halo)]',
                  )}
                  style={{ background: MIXER_SWATCH[c], opacity: active ? 1 : 0.62 }}
                >
                  {v !== 0 && (
                    <span className="numeric absolute -bottom-1 rounded-[4px] bg-s1 px-1 text-[9px] text-t1 shadow-[var(--e1)]">
                      {v > 0 ? '+' : ''}
                      {v}
                    </span>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
        {(['h', 's', 'l'] as const).map((a) => (
          <ParamSlider
            key={a}
            path={`mixer.${channel}.${a}`}
            label={`${MIXER_LABELS[channel]} ${a === 'h' ? 'hue' : a === 's' ? 'saturation' : 'luminance'}`}
            min={-100}
            max={100}
            step={1}
          />
        ))}
        <div className="flex items-center gap-1 px-1 pt-1">
          <Button
            size="xs"
            variant="subtle"
            icon="restart"
            onClick={() => {
              const mixer = { ...params.mixer };
              for (const c of MIXER_CHANNELS) mixer[c] = { h: 0, s: 0, l: 0 };
              replaceLive({ ...params, mixer });
              commitLive('Reset mixer');
            }}
          >
            Reset mixer
          </Button>
          <span className="ml-auto text-2xs text-t3">{axis === 'h' ? 'shift' : axis === 's' ? 'intensity' : 'brightness'}</span>
        </div>
      </Section>

      <Section title="Colour grading" icon="palette" dense>
        {(['shadows', 'mids', 'highs'] as const).map((band) => (
          <div key={band} className="mb-2">
            <GroupHead title={band === 'mids' ? 'Midtones' : band === 'highs' ? 'Highlights' : 'Shadows'} />
            <GradeWheel band={band} />
            <ParamSlider path={`grading.${band}.lum`} label="Luminance" min={-100} max={100} step={1} compact />
          </div>
        ))}
        <ParamSlider path="grading.blend" label="Blend" min={0} max={100} step={1} />
        <ParamSlider path="grading.balance" label="Balance" min={-100} max={100} step={1} />
      </Section>

      <Section title="Point colour" icon="eyedropper" dense defaultOpen={false}>
        <PointColorList />
      </Section>

      <Section title="Black & white mix" icon="contrast" dense defaultOpen={false}>
        {params.treatment === 'bw' ? (
          MIXER_CHANNELS.map((c) => (
            <ParamSlider key={c} path={`mixer.${c}.l`} label={MIXER_LABELS[c]} min={-100} max={100} step={1} />
          ))
        ) : (
          <p className="px-2 py-1 text-2xs text-t3">
            Switch Treatment to Black &amp; White (Light panel) to mix the mono channels.
          </p>
        )}
      </Section>
    </div>
  );
}

/** Hue/saturation wheel — angle = hue, radius = saturation. */
function GradeWheel({ band }: { band: 'shadows' | 'mids' | 'highs' }) {
  const params = useLive();
  const g = params.grading[band];
  const [drag, setDrag] = useState(false);
  const size = 92;

  const set = (hue: number, sat: number) => {
    replaceLive({
      ...params,
      grading: { ...params.grading, [band]: { ...g, hue: Math.round(hue), sat: Math.round(sat) } },
    });
  };

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    let hue = (Math.atan2(y, x) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    const sat = Math.min(1, Math.hypot(x, y) * 2) * 100;
    set(hue, sat);
  };

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <div
        role="application"
        aria-label={`${band} grading wheel`}
        tabIndex={0}
        onPointerDown={(e) => {
          setDrag(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => drag && pick(e)}
        onPointerUp={(e) => {
          setDrag(false);
          e.currentTarget.releasePointerCapture(e.pointerId);
          commitLive(`Grade ${band}`);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1 : 5;
          if (e.key === 'ArrowRight') set((g.hue + step) % 360, g.sat);
          if (e.key === 'ArrowLeft') set((g.hue - step + 360) % 360, g.sat);
          if (e.key === 'ArrowUp') set(g.hue, Math.min(100, g.sat + step));
          if (e.key === 'ArrowDown') set(g.hue, Math.max(0, g.sat - step));
        }}
        className="relative shrink-0 cursor-crosshair rounded-full"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(from 0deg,
            oklch(0.6 0.14 0), oklch(0.6 0.14 60), oklch(0.6 0.14 120),
            oklch(0.6 0.14 180), oklch(0.6 0.14 240), oklch(0.6 0.14 300), oklch(0.6 0.14 360))`,
          mask: 'radial-gradient(circle, #000 0 100%, transparent 100%)',
          opacity: 0.9,
        }}
      >
        <span className="absolute inset-[22%] rounded-full bg-s2 shadow-[var(--e-inset)]" />
        <span
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-t1 shadow-[var(--e2)]"
          style={{
            left: `${50 + Math.cos((g.hue * Math.PI) / 180) * (g.sat / 100) * 46}%`,
            top: `${50 + Math.sin((g.hue * Math.PI) / 180) * (g.sat / 100) * 46}%`,
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="numeric text-2xs text-t3">
          H {Math.round(g.hue)}° · S {Math.round(g.sat)}
        </div>
        <ParamSlider path={`grading.${band}.hue`} label="Hue" min={0} max={360} step={1} compact hideValue />
        <ParamSlider path={`grading.${band}.sat`} label="Sat" min={0} max={100} step={1} compact hideValue />
        <Button
          size="xs"
          variant="ghost"
          className="mt-0.5 px-1"
          onClick={() => {
            set(0, 0);
            commitLive(`Reset ${band} grade`);
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

function PointColorList() {
  const params = useLive();
  const points = params.pointColor;
  return (
    <div className="flex flex-col gap-1 px-1">
      {points.length === 0 && (
        <p className="py-1 text-2xs text-t3">
          Pick a colour from the photo to build a range selection — like a targeted HSL adjustment.
        </p>
      )}
      {points.map((pc) => (
        <div key={pc.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-s2 p-1.5">
          <span
            className="size-6 shrink-0 rounded-[6px] shadow-[var(--e-inset)]"
            style={{ background: `oklch(${pc.l} ${pc.c} ${pc.h})` }}
          />
          <div className="min-w-0 flex-1">
            <div className="numeric text-2xs text-t2">
              H {Math.round(pc.h)}° C {pc.c.toFixed(3)} L {pc.l.toFixed(2)}
            </div>
            <div className="flex gap-1">
              <IconButton
                name="eye"
                size={12}
                box="sm"
                label="Show mask"
                pressed={pc.showMask}
                onClick={() =>
                  replaceLive({
                    ...params,
                    pointColor: points.map((x) => (x.id === pc.id ? { ...x, showMask: !x.showMask } : x)),
                  })
                }
              />
            </div>
          </div>
          <IconButton
            name="trash"
            size={13}
            box="sm"
            label="Remove point colour"
            onClick={() => {
              replaceLive({ ...params, pointColor: points.filter((x) => x.id !== pc.id) });
              commitLive('Remove point colour');
            }}
          />
        </div>
      ))}
      <Button
        size="xs"
        variant="subtle"
        icon="eyedropper"
        onClick={() => {
          editorStore.set(patchToolAtom, { tool: 'eyedropper' });
        }}
      >
        Add from photo
      </Button>
    </div>
  );
}

/* ========================================================================== */
/*  DETAIL & EFFECTS                                                           */
/* ========================================================================== */

export function DetailPanel() {
  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="Sharpening" icon="aperture" dense>
        <ParamSlider path="detail.sharpen.amount" label="Amount" min={0} max={150} step={1} />
        <ParamSlider path="detail.sharpen.radius" label="Radius" min={0.5} max={3} step={0.1} unit="px" />
        <ParamSlider path="detail.sharpen.detail" label="Detail" min={0} max={100} step={1} />
        <ParamSlider path="detail.sharpen.masking" label="Masking" min={0} max={100} step={1} hint="⌥ to preview" />
      </Section>

      <Section title="Noise reduction" icon="grain" dense>
        <ParamSlider path="detail.nr.luminance" label="Luminance" min={0} max={100} step={1} />
        <ParamSlider path="detail.nr.detail" label="Detail" min={0} max={100} step={1} />
        <ParamSlider path="detail.nr.contrast" label="Contrast" min={0} max={100} step={1} />
        <ParamSlider path="detail.nr.color" label="Colour" min={0} max={100} step={1} />
        <ParamSlider path="detail.nr.colorSmoothness" label="Smoothness" min={0} max={100} step={1} />
      </Section>

      <Section title="AI denoise" icon="magic" dense defaultOpen={false}>
        <ParamSwitch path="detail.aiDenoise.enabled" label="Enable" description="Runs on-device (ONNX) · ~1.2 s" />
        <ParamSlider path="detail.aiDenoise.strength" label="Strength" min={0} max={100} step={1} />
        <ParamSwitch path="detail.deconvolution" label="Deconvolution" description="Recover lens-limited detail" />
        <Badge tone="muted" className="mx-1">
          Model not downloaded — see Models manager
        </Badge>
      </Section>
    </div>
  );
}

export function EffectsPanel() {
  return (
    <div className="flex flex-col gap-1 pb-6">
      <Section title="Vignette" icon="aperture" dense>
        <ParamSelect
          path="effects.vignette.style"
          label="Style"
          options={[
            { value: 'highlightPriority', label: 'Highlight priority' },
            { value: 'colorPriority', label: 'Colour priority' },
            { value: 'paintOverlay', label: 'Paint overlay' },
          ]}
        />
        <ParamSlider path="effects.vignette.amount" label="Amount" min={-100} max={100} step={1} />
        <ParamSlider path="effects.vignette.midpoint" label="Midpoint" min={0} max={100} step={1} />
        <ParamSlider path="effects.vignette.roundness" label="Roundness" min={-100} max={100} step={1} />
        <ParamSlider path="effects.vignette.feather" label="Feather" min={0} max={100} step={1} />
        <ParamSlider path="effects.vignette.highlights" label="Highlights" min={0} max={100} step={1} />
      </Section>

      <Section title="Grain" icon="grain" dense>
        <ParamSlider path="effects.grain.amount" label="Amount" min={0} max={100} step={1} />
        <ParamSlider path="effects.grain.size" label="Size" min={1} max={100} step={1} />
        <ParamSlider path="effects.grain.roughness" label="Roughness" min={0} max={100} step={1} />
      </Section>

      <Section title="Atmosphere" icon="cloud" dense defaultOpen={false}>
        <p className="px-2 py-1 text-2xs text-t3">
          Bloom, halation and soft-focus live per layer — add an adjustment layer and open the Layers inspector.
        </p>
        <Button size="xs" variant="subtle" icon="layers" onClick={() => undefined}>
          Open Layers
        </Button>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

export function PanelEmpty({ text }: { text: string }) {
  return <p className="px-2 py-3 text-2xs text-t3">{text}</p>;
}

export function useTool() {
  return useAtomValue(toolAtom);
}

export { Chip };
