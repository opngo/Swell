import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Histogram — module glyph for tone. */
export function HistogramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <path d="M3 20h18" {...p} />
      <path d="M5.5 20v-4.5M9 20V9.5M12.5 20V5M16 20v-7.5M19.5 20v-3" {...p} />
    </CustomIcon>
  );
}
export default HistogramIcon;
