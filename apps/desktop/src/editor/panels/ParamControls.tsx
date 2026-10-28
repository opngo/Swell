/**
 * Param controls — the bridge between the inspector and the live Jotai doc.
 *
 * `<ParamSlider path="tone.exposure" … />` reads the current value from
 * `liveParamsAtom`, writes every frame back to it (no React tree above it
 * re-renders, no history entry) and commits exactly one labelled history entry
 * when the gesture ends. Double-click resets to the schema default.
 */

import { useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { editorStore, liveParamsAtom, patchLiveAtom, commitGestureAtom, setLiveAtom } from '@/state/atoms.ts';
import { defaultParams, type DevelopParams } from '@swell/schema';
import { Slider, type SliderProps } from '@/ui/Slider.tsx';
import { Switch, Select, ColorField, SegmentedControl, type Option } from '@/ui/Controls.tsx';
import { IconButton } from '@/ui/Button.tsx';
import { Tooltip } from '@/ui/Overlay.tsx';
import { cx } from '@/ui/cx.ts';

const DEFAULTS = defaultParams();

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

/** `{ 'tone.exposure': 0.4 }` → `{ tone: { exposure: 0.4 } }` */
export function pathPatch(path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  let out: Record<string, unknown> = { [parts[parts.length - 1]!]: value };
  for (let i = parts.length - 2; i >= 0; i--) out = { [parts[i]!]: out };
  return out;
}

export const defaultFor = (path: string): unknown => getPath(DEFAULTS, path);

/** Live params for the photo being edited. */
export function useLive(): DevelopParams {
  return useAtomValue(liveParamsAtom).params;
}

/** Write a value into the live doc (per-frame path). */
export function writeLive(path: string, value: unknown) {
  editorStore.set(patchLiveAtom, pathPatch(path, value));
}

/** Write an arbitrary nested patch into the live doc. */
export function writeLivePatch(patch: Record<string, unknown>) {
  editorStore.set(patchLiveAtom, patch);
}

/** End a gesture: one history entry. */
export function commitLive(label: string) {
  editorStore.set(commitGestureAtom, label);
}

/** Replace the whole live doc (curve editors, layer ops). */
export function replaceLive(params: DevelopParams) {
  editorStore.set(setLiveAtom, params);
}

/* ------------------------------------------------------------------ slider */

export interface ParamSliderProps extends Omit<SliderProps, 'value' | 'onChange' | 'onCommit' | 'label'> {
  path: string;
  label: string;
  /** history label; defaults to `label` */
  historyLabel?: string;
  disabled?: boolean;
}

export function ParamSlider({ path, label, historyLabel, defaultValue, disabled, ...rest }: ParamSliderProps) {
  const params = useLive();
  const raw = getPath(params, path);
  const value = typeof raw === 'number' ? raw : 0;
  const def = defaultValue ?? (typeof defaultFor(path) === 'number' ? (defaultFor(path) as number) : 0);

  const onChange = useCallback((v: number) => writeLive(path, v), [path]);
  const onCommit = useCallback(
    (_v: number, ctx: { from: number; to: number }) => {
      if (ctx.from === ctx.to) return;
      commitLive(historyLabel ?? label);
    },
    [historyLabel, label],
  );

  const isModified = Math.abs(value - def) > 1e-6;

  return (
    <div className="group/param relative">
      <Slider
        label={label}
        value={value}
        defaultValue={def}
        onChange={onChange}
        onCommit={onCommit}
        disabled={disabled}
        bipolar={def === 0 && (rest.min ?? 0) < 0}
        {...rest}
      />
      {isModified && !disabled && (
        <Tooltip label={`Reset ${label}`} placement="left">
          <span className="absolute top-1.5 -left-1.5 opacity-0 transition-opacity duration-150 group-hover/param:opacity-100">
            <IconButton
              name="restart"
              size={11}
              box="sm"
              label={`Reset ${label}`}
              className="size-4 text-[var(--color-accent)]"
              onClick={() => {
                writeLive(path, def);
                commitLive(`Reset ${label}`);
              }}
            />
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ toggle */

export function ParamSwitch({
  path,
  label,
  description,
  historyLabel,
  disabled,
}: {
  path: string;
  label: string;
  description?: string;
  historyLabel?: string;
  disabled?: boolean;
}) {
  const params = useLive();
  const checked = !!getPath(params, path);
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      label={label}
      description={description}
      onChange={(v) => {
        writeLive(path, v);
        commitLive(historyLabel ?? `${label} ${v ? 'on' : 'off'}`);
      }}
    />
  );
}

/* ------------------------------------------------------------------ select */

export function ParamSelect<T extends string>({
  path,
  label,
  options,
  historyLabel,
  size = 'sm',
  className,
}: {
  path: string;
  label?: string;
  options: readonly Option<T>[];
  historyLabel?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const params = useLive();
  const value = (getPath(params, path) as T) ?? (options[0]?.value as T);
  return (
    <div className={cx('flex items-center gap-2 px-1', className)}>
      {label && <span className="min-w-0 flex-1 truncate text-xs text-t2">{label}</span>}
      <Select
        size={size}
        ariaLabel={label ?? path}
        className={label ? 'w-40' : 'w-full'}
        value={value}
        options={options}
        onChange={(v) => {
          writeLive(path, v);
          commitLive(historyLabel ?? `${label ?? 'Setting'}: ${options.find((o) => o.value === v)?.label ?? v}`);
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------- segmented row */

export function ParamSegmented<T extends string>({
  path,
  options,
  label,
  historyLabel,
}: {
  path: string;
  options: readonly { value: T; label?: string; icon?: never; title?: string }[];
  label?: string;
  historyLabel?: string;
}) {
  const params = useLive();
  const value = (getPath(params, path) as T) ?? options[0].value;
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-1">
      {label && <span className="text-xs text-t2">{label}</span>}
      <SegmentedControl
        size="sm"
        ariaLabel={label ?? path}
        value={value}
        segments={options}
        onChange={(v) => {
          writeLive(path, v);
          commitLive(historyLabel ?? `${label ?? 'Mode'}: ${v}`);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- colour */

export function ParamColor({
  path,
  label,
  historyLabel,
}: {
  path: string;
  label: string;
  historyLabel?: string;
}) {
  const params = useLive();
  const css = String(getPath(params, path) ?? '#808080');
  const rgb = useMemo(() => hexToRgb01(css), [css]);
  return (
    <ColorField
      label={label}
      color={rgb}
      onChange={(c) => {
        writeLive(path, rgb01ToHex(c));
      }}
    />
  );
}

export function hexToRgb01(css: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return { r: 0.5, g: 0.5, b: 0.5 };
  const n = parseInt(m[1]!, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgb01ToHex(c: { r: number; g: number; b: number }): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`;
}

/* --------------------------------------------------------------- group head */

export function GroupHead({
  title,
  onReset,
  right,
  modified,
}: {
  title: string;
  onReset?: () => void;
  right?: React.ReactNode;
  modified?: boolean;
}) {
  return (
    <div className="mb-1 flex items-center gap-2 px-2 pt-1">
      <span className="text-2xs font-medium tracking-[0.06em] text-t3 uppercase">{title}</span>
      {modified && <span className="size-1.5 rounded-full bg-[var(--color-accent)]" aria-label="Modified" />}
      <span className="ml-auto flex items-center gap-1">
        {right}
        {onReset && (
          <Tooltip label={`Reset ${title}`} placement="left">
            <span>
              <IconButton name="restart" size={13} box="sm" label={`Reset ${title}`} onClick={onReset} />
            </span>
          </Tooltip>
        )}
      </span>
    </div>
  );
}
