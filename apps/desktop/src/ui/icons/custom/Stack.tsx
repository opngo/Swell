import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Stack — burst/stack count badge. */
export function StackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <rect x="3.5" y="7.5" width="13" height="13" rx="3" {...p} />
      <path d="M7.5 4.2A2.7 2.7 0 0 1 10 3.5h7.5A3 3 0 0 1 20.5 6.5V14a2.7 2.7 0 0 1-.8 2.4" {...p} />
    </CustomIcon>
  );
}
export default StackIcon;
