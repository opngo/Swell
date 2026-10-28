import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Red-eye correction. */
export function RedEyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12Z" {...p} />
      <circle cx="12" cy="12" r="2.8" {...p} />
      <path d="m4.6 4.6 14.8 14.8" {...p} />
    </CustomIcon>
  );
}
export default RedEyeIcon;
