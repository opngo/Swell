import type { ReactNode, SVGProps } from 'react';

/**
 * Custom icons live here (spec §11) and match Iconoir exactly:
 * 24×24 viewBox · strokeWidth 1.5 · round caps/joins · currentColor · 1.5em box.
 */
export function CustomIcon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="1.5em"
      height="1.5em"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      color="currentColor"
      {...props}
    >
      {children}
    </svg>
  );
}

export const p = { stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
