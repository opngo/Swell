import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Layers — no Iconoir match. Three stacked plates. */
export function LayersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z" {...p} />
      <path d="M3 12.5 12 17l9-4.5" {...p} />
      <path d="M3 16.8 12 21.3l9-4.5" {...p} />
    </CustomIcon>
  );
}
export default LayersIcon;
