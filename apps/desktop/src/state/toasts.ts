import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type ToastTone = 'info' | 'ok' | 'warn' | 'danger';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  /** ms; 0 = sticky until dismissed */
  duration: number;
  action?: { label: string; run: () => void };
  progress?: number;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'createdAt'> & { id?: string }) => string;
  dismiss: (id: string) => void;
  update: (id: string, patch: Partial<Toast>) => void;
  clear: () => void;
}

let n = 0;
const nextId = () => `t${Date.now().toString(36)}${(n++).toString(36)}`;

export const useToasts = create<ToastState>()(
  immer((set) => ({
    toasts: [],
    push: (t) => {
      const id = t.id ?? nextId();
      set((st) => {
        st.toasts = st.toasts.filter((x) => x.id !== id);
        st.toasts.push({
          id,
          title: t.title,
          description: t.description,
          tone: t.tone ?? 'info',
          duration: t.duration ?? 4200,
          action: t.action,
          progress: t.progress,
          createdAt: Date.now(),
        });
        // cap the stack so a runaway loop can't cover the UI
        if (st.toasts.length > 5) st.toasts.splice(0, st.toasts.length - 5);
      });
      return id;
    },
    dismiss: (id) => set((st) => { st.toasts = st.toasts.filter((t) => t.id !== id); }),
    update: (id, patch) =>
      set((st) => {
        const t = st.toasts.find((x) => x.id === id);
        if (t) Object.assign(t, patch);
      }),
    clear: () => set((st) => { st.toasts = []; }),
  })),
);

export const toast = {
  info: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'info', duration: 4200 }),
  ok: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'ok', duration: 3600 }),
  warn: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'warn', duration: 6000 }),
  error: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'danger', duration: 0 }),
  progress: (id: string, title: string, progress: number, description?: string) =>
    useToasts.getState().push({ id, title, description, tone: 'info', duration: 0, progress }),
};
