import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Brush — Iconoir has Erase but no paint brush. */
export function BrushIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <path d="M15.6 3.9 20 8.3l-7.4 7.4H8.2v-4.4l7.4-7.4Z" {...p} />
      <path d="M8.2 15.7c0 2.2-1.4 3.1-2.4 3.7-.7.5-1 1-1 1.9 2.6.6 6.6-.2 6.6-4.2" {...p} />
    </CustomIcon>
  );
}
export default BrushIcon;
