import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Grain / film texture. */
export function GrainIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" {...p} />
      <path d="M8 8h.01M12 7.5h.01M16 8.5h.01M7.5 12h.01M11 12h.01M14.5 12h.01M17.5 12.5h.01M8.5 16h.01M12.5 16h.01M16 16.5h.01" {...p} />
    </CustomIcon>
  );
}
export default GrainIcon;
