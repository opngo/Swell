import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from './cx.ts';
import { SwIcon, type IconName } from './icons.tsx';
import { Keycap } from './Button.tsx';
import { spring } from './motion.ts';
import { useReducedMotion } from './useReducedMotion.ts';

/* -------------------------------------------------------------------------- */
/*  Overlays: tooltip · popover · menu · context menu · modal · sheet          */
/*                                                                             */
/*  Hand-rolled on purpose: every one of these needs a borderless, tonal       */
/*  treatment, and they share one positioning + focus engine.                  */
/* -------------------------------------------------------------------------- */

type Placement = 'top' | 'bottom' | 'left' | 'right' | 'bottom-start' | 'bottom-end' | 'top-start';

interface FloatPos {
  top: number;
  left: number;
  placement: Placement;
}

function positionFloat(
  anchor: DOMRect,
  panel: { width: number; height: number },
  placement: Placement,
  gap = 8,
  pad = 10,
): FloatPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = 0;
  let left = 0;
  switch (placement) {
    case 'top':
      top = anchor.top - panel.height - gap;
      left = anchor.left + anchor.width / 2 - panel.width / 2;
      break;
    case 'top-start':
      top = anchor.top - panel.height - gap;
      left = anchor.left;
      break;
    case 'bottom':
      top = anchor.bottom + gap;
      left = anchor.left + anchor.width / 2 - panel.width / 2;
      break;
    case 'bottom-start':
      top = anchor.bottom + gap;
      left = anchor.left;
      break;
    case 'bottom-end':
      top = anchor.bottom + gap;
      left = anchor.right - panel.width;
      break;
    case 'left':
      top = anchor.top + anchor.height / 2 - panel.height / 2;
      left = anchor.left - panel.width - gap;
      break;
    case 'right':
      top = anchor.top + anchor.height / 2 - panel.height / 2;
      left = anchor.right + gap;
      break;
  }
  // flip vertically when it would leave the viewport
  if (top < pad && placement.startsWith('bottom')) top = anchor.top - panel.height - gap;
  if (top + panel.height > vh - pad && placement.startsWith('top')) top = anchor.bottom + gap;
  top = Math.max(pad, Math.min(top, vh - panel.height - pad));
  left = Math.max(pad, Math.min(left, vw - panel.width - pad));
  return { top, left, placement };
}

/** Shared floating container: portal + position + click-outside + Esc. */
function useFloating(open: boolean, anchorRef: React.RefObject<HTMLElement | null>, placement: Placement, gap = 8) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<FloatPos | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const measure = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!a || !p) return;
      setPos(positionFloat(a, { width: p.offsetWidth, height: p.offsetHeight }, placement, gap));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchorRef, placement, gap]);

  return { panelRef, pos };
}

/* ---------------------------------- Tooltip -------------------------------- */

const TooltipCtx = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function Tooltip({
  label,
  placement = 'top',
  shortcut,
  children,
  delay = 420,
}: {
  label: ReactNode;
  placement?: Placement;
  shortcut?: string;
  children: ReactNode;
  delay?: number;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = anchor;
  const timer = useRef<number | undefined>(undefined);
  const reduce = useReducedMotion();

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [delay]);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const { panelRef, pos } = useFloating(open, anchorRef as React.RefObject<HTMLElement | null>, placement, 8);
  const ctx = useMemo(() => ({ open, setOpen }), [open]);

  return (
    <TooltipCtx.Provider value={ctx}>
      <span
        ref={(el) => {
          if (el) setAnchor(el);
        }}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
        className="contents"
      >
        {children}
      </span>
      {open &&
        anchor &&
        createPortal(
          <motion.div
            ref={panelRef}
            role="tooltip"
            initial={reduce ? false : { opacity: 0, scale: 0.96, y: placement.startsWith('top') ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="glass-strong pointer-events-none z-[9500] flex max-w-64 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-2xs text-t1 shadow-[var(--e2)]"
          >
            <span className="leading-tight">{label}</span>
            {shortcut && <Keycap className="ml-auto">{shortcut}</Keycap>}
          </motion.div>,
          document.body,
        )}
    </TooltipCtx.Provider>
  );
}

/* ---------------------------------- Popover -------------------------------- */

export interface PopoverProps {
  content: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  className?: string;
  trigger: (props: {
    ref: React.RefCallback<HTMLElement>;
    open: boolean;
    toggle: () => void;
    ariaExpanded: boolean;
    ariaHasPopup: boolean;
  }) => ReactNode;
  /** keep the popover mounted while closed (for menus that animate out) */
  matchWidth?: boolean;
}

export function Popover({ content, placement = 'bottom-end', className, trigger, matchWidth }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = anchor;
  const { panelRef, pos } = useFloating(open, anchorRef as React.RefObject<HTMLElement | null>, placement, 8);
  const reduce = useReducedMotion();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      anchorRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    const t = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')
        ?.focus();
    }, 24);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.clearTimeout(t);
    };
  }, [open, panelRef]);

  return (
    <>
      {trigger({ ref: (el) => setAnchor(el), open, toggle: () => setOpen((v) => !v), ariaExpanded: open, ariaHasPopup: true })}
      <AnimatePresence>
        {open &&
          anchor &&
          createPortal(
            <motion.div
              key="popover"
              ref={panelRef}
              role="dialog"
              initial={reduce ? false : { opacity: 0, scale: 0.97, y: placement.startsWith('top') ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
              transition={spring.snappy}
              style={{
                position: 'fixed',
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos ? 'visible' : 'hidden',
                width: matchWidth && anchor ? Math.max(160, anchor.getBoundingClientRect().width) : undefined,
                transformOrigin: placement.startsWith('top') ? 'bottom center' : 'top center',
              }}
              className={cx('glass-strong z-[9100] rounded-[var(--radius-md)] shadow-[var(--e3)]', className)}
            >
              {typeof content === 'function' ? content(close) : content}
            </motion.div>,
            document.body,
          )}
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------ Menu --------------------------------- */

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: IconName;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  /** nested submenu */
  submenu?: MenuItem[];
  separator?: boolean;
}

export function MenuList({
  items,
  onClose,
  className,
  title,
}: {
  items: MenuItem[];
  onClose: () => void;
  className?: string;
  title?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const it = items[index];
        if (it && !it.disabled && !it.separator) {
          it.onSelect?.();
          onClose();
        }
      } else if (e.key === 'Home') {
        setIndex(0);
      } else if (e.key === 'End') {
        setIndex(items.length - 1);
      }
    };
    el.addEventListener('keydown', onKey);
    el.focus();
    return () => el.removeEventListener('keydown', onKey);
  }, [items, index, onClose]);

  return (
    <div
      ref={listRef}
      role="menu"
      tabIndex={-1}
      aria-label={title}
      className={cx('flex min-w-52 flex-col gap-0.5 p-1 outline-none', className)}
    >
      {title && <div className="px-2 py-1 text-2xs font-medium text-t3">{title}</div>}
      {items.map((item, i) =>
        item.separator ? (
          <div key={item.id} role="separator" className="my-1.5 shrink-0" />
        ) : (
          <button
            key={item.id}
            role="menuitem"
            type="button"
            disabled={item.disabled}
            tabIndex={-1}
            onPointerEnter={() => setIndex(i)}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              onClose();
            }}
            className={cx(
              'flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs',
              'transition-colors duration-[100ms] disabled:opacity-35',
              i === index ? 'bg-s4 text-t1' : 'text-t2',
              item.danger && i === index && 'bg-[oklch(0.68_0.19_25/0.22)] text-[var(--color-danger)]',
              item.danger && i !== index && 'text-[var(--color-danger)]/80',
            )}
          >
            {item.icon ? (
              <SwIcon name={item.icon} size={16} className="shrink-0 opacity-80" />
            ) : (
              <span className="w-4 shrink-0">{item.checked && <SwIcon name="check" size={14} />}</span>
            )}
            <span className="truncate">{item.label}</span>
            {item.shortcut && <Keycap className="ml-auto shrink-0">{item.shortcut}</Keycap>}
            {item.submenu && <SwIcon name="chevronRight" size={14} className="ml-auto opacity-60" />}
          </button>
        ),
      )}
    </div>
  );
}

export function Menu({
  items,
  trigger,
  placement = 'bottom-end',
  title,
  className,
}: {
  items: MenuItem[];
  trigger: (props: { ref: React.RefCallback<HTMLElement>; open: boolean; toggle: () => void }) => ReactNode;
  placement?: Placement;
  title?: string;
  className?: string;
}) {
  return (
    <Popover
      placement={placement}
      className={className}
      trigger={({ ref, open, toggle }) => trigger({ ref, open, toggle })}
      content={(close) => <MenuList items={items} onClose={close} title={title} />}
    />
  );
}

/* -------------------------------- ContextMenu ------------------------------ */

export function ContextMenu({
  items,
  children,
  className,
}: {
  items: MenuItem[] | ((target: HTMLElement) => MenuItem[]);
  children: ReactNode;
  className?: string;
}) {
  const [state, setState] = useState<{ x: number; y: number; target: HTMLElement } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('wheel', close, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('wheel', close);
    };
  }, [state]);

  const list = typeof items === 'function' && state ? items(state.target) : (items as MenuItem[]);

  return (
    <>
      <div
        className="contents"
        onContextMenu={(e) => {
          e.preventDefault();
          setState({ x: e.clientX, y: e.clientY, target: e.currentTarget as HTMLElement });
        }}
      >
        {children}
      </div>
      <AnimatePresence>
        {state &&
          createPortal(
            <motion.div
              ref={panelRef}
              initial={reduce ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
              transition={spring.snappy}
              style={{
                position: 'fixed',
                left: Math.min(state.x, window.innerWidth - 260),
                top: Math.min(state.y, window.innerHeight - list.length * 32 - 24),
              }}
              className="glass-strong z-[9200] rounded-[var(--radius-md)] shadow-[var(--e3)]"
            >
              <MenuList items={list} onClose={() => setState(null)} className={className} />
            </motion.div>,
            document.body,
          )}
      </AnimatePresence>
    </>
  );
}

/* ----------------------------------- Modal --------------------------------- */

let modalStack = 0;

export function Modal({
  open,
  onClose,
  children,
  label,
  size = 'md',
  className,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode | ((close: () => void) => ReactNode);
  label: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
  dismissable?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();
  const id = useId();

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    modalStack++;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        'input,select,textarea,button:not([data-modal-close]),[tabindex]:not([tabindex="-1"])',
      );
      (el ?? panelRef.current)?.focus();
    }, 30);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable && modalStack === 1) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // focus trap
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.clearTimeout(t);
      modalStack = Math.max(0, modalStack - 1);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, dismissable]);

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
    full: 'max-w-[min(1400px,96vw)]',
  }[size];

  return (
    <AnimatePresence>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[9400] flex items-center justify-center p-6">
            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => dismissable && onClose()}
              className="absolute inset-0 bg-[oklch(0.1_0.008_250/0.62)] backdrop-blur-[6px]"
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              aria-labelledby={id}
              tabIndex={-1}
              initial={reduce ? false : { opacity: 0, scale: 0.965, y: 16, filter: 'blur(8px)' }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.98, y: 8, filter: 'blur(6px)' }}
              transition={spring.swell}
              className={cx(
                'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)]',
                'bg-s1 shadow-[var(--e3)]',
                widths,
                className,
              )}
            >
              {typeof children === 'function' ? children(onClose) : children}
            </motion.div>
          </div>,
          document.body,
        )}
    </AnimatePresence>
  );
}

export function ModalHeader({
  title,
  subtitle,
  icon,
  onClose,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  onClose?: () => void;
}) {
  return (
    <header className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
      {icon && (
        <span className="mt-0.5 grid size-8 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <SwIcon name={icon} size={18} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-display truncate text-lg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-t3">{subtitle}</p>}
      </div>
      {onClose && (
        <button
          type="button"
          data-modal-close
          onClick={onClose}
          aria-label="Close"
          className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-t3 transition-colors hover:bg-s3 hover:text-t1"
        >
          <SwIcon name="close" size={16} />
        </button>
      )}
    </header>
  );
}

export function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('min-h-0 flex-1 overflow-y-auto px-5 pb-4', className)}>{children}</div>;
}

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <footer className={cx('flex shrink-0 items-center justify-end gap-2 bg-s2/60 px-5 py-3', className)}>
      {children}
    </footer>
  );
}

/* ----------------------------------- Sheet --------------------------------- */

export function Sheet({
  open,
  onClose,
  children,
  side = 'right',
  width = 420,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  side?: 'right' | 'left';
  width?: number;
  label: string;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[9300]">
            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-[oklch(0.1_0.008_250/0.5)] backdrop-blur-[4px]"
              onClick={onClose}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={label}
              initial={reduce ? false : { x: side === 'right' ? width : -width }}
              animate={{ x: 0 }}
              exit={reduce ? undefined : { x: side === 'right' ? width : -width }}
              transition={spring.smooth}
              style={{ width }}
              className={cx(
                'absolute inset-y-0 flex flex-col bg-s1 shadow-[var(--e3)]',
                side === 'right' ? 'right-0 rounded-l-[var(--radius-xl)]' : 'left-0 rounded-r-[var(--radius-xl)]',
              )}
            >
              {children}
            </motion.aside>
          </div>,
          document.body,
        )}
    </AnimatePresence>
  );
}
