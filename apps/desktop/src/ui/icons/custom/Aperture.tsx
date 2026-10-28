import type { SVGProps } from 'react';
import { CustomIcon, p } from './base.tsx';

/** Aperture — exposure / lens contexts. */
export function ApertureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CustomIcon {...props}>
      <circle cx="12" cy="12" r="9" {...p} />
      <path d="M12 3v7.2M20.8 8.4l-6.6 3.6M18.4 19.6l-3.2-6.9M5.6 19.6l6.6-3.6M3.2 8.4l6.6 3.6" {...p} />
    </CustomIcon>
  );
}
export default ApertureIcon;
