import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Merge / split — before-after split, merge down. */
export function MergeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <path d="M7 3.5v6.2c0 1.5.8 2.4 2.2 2.9l2 .7" {...p} />
      <path d="M17 3.5v6.2c0 1.5-.8 2.4-2.2 2.9l-2 .7" {...p} />
      <path d="M12 13.3v7.2M9.4 17.9 12 20.5l2.6-2.6" {...p} />
    </CustomIcon>
  );
}

export function SplitIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <path d="M12 3.5v7.2" {...p} />
      <path d="M12 10.7 9.4 13.3c-1.4.6-2.2 1.5-2.2 3v4.2" {...p} />
      <path d="m12 10.7 2.6 2.6c1.4.6 2.2 1.5 2.2 3v4.2" {...p} />
      <path d="M4.6 18.2 7.2 20.8l2.6-2.6M14.2 18.2l2.6 2.6 2.6-2.6" {...p} />
    </CustomIcon>
  );
}
export default MergeIcon;
