import { useEffect, useState } from 'react';
import { useSettings } from '@/state/settings.ts';

/**
 * Reduced motion = OS preference OR the in-app toggle (§3.4).
 * When true, every animation collapses to an instant state change.
 */
export function useReducedMotion(): boolean {
  const [osPrefers, setOsPrefers] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setOsPrefers(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const appPrefers = useSettings((s) => s.reduceMotion);
  return osPrefers || appPrefers;
}

export default useReducedMotion;
