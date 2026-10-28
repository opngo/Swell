import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Heal / spot removal. */
export function HealIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <circle cx="9" cy="9" r="5.5" {...p} />
      <path d="m13.2 13.2 3.3 3.3" {...p} />
      <circle cx="18.4" cy="18.4" r="2.6" {...p} />
      <path d="M9 6.8v4.4M6.8 9h4.4" {...p} />
    </CustomIcon>
  );
}
export default HealIcon;
