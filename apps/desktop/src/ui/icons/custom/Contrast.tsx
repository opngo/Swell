import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Contrast — half-filled circle. */
export function ContrastIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <circle cx="12" cy="12" r="8.5" {...p} />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none" />
    </CustomIcon>
  );
}
export default ContrastIcon;
