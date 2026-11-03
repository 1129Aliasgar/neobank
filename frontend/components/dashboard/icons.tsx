/**
 * The dashboard's icon set, drawn rather than imported.
 *
 * Same reason as the seal in `components/brand/wordmark.tsx`: a handful of
 * hairlines keeps the product's line weight consistent and keeps an icon pack
 * out of the bundle. Every icon inherits `currentColor`.
 */

import type { SVGProps } from "react";
import type { NavIconName } from "@/lib/dashboard";

type IconProps = SVGProps<SVGSVGElement>;

function Frame({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function NavIcon({ name, ...props }: IconProps & { name: NavIconName }) {
  switch (name) {
    case "overview":
      return (
        <Frame {...props}>
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="0.5" />
          <rect x="14" y="3.5" width="6.5" height="6.5" rx="0.5" />
          <rect x="3.5" y="14" width="6.5" height="6.5" rx="0.5" />
          <rect x="14" y="14" width="6.5" height="6.5" rx="0.5" />
        </Frame>
      );

    case "account":
      return (
        <Frame {...props}>
          <path d="M3 9.5 12 4l9 5.5" />
          <path d="M5.5 10v8.5M18.5 10v8.5M9.5 10v8.5M14.5 10v8.5" />
          <path d="M3 20.5h18" />
        </Frame>
      );

    case "transactions":
      return (
        <Frame {...props}>
          <path d="M4 7.5h14" />
          <path d="m15 4.5 3 3-3 3" />
          <path d="M20 16.5H6" />
          <path d="m9 13.5-3 3 3 3" />
        </Frame>
      );

    case "team":
      return (
        <Frame {...props}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
          <path d="M18.2 20c0-2.2-.7-4.2-2-5.7" />
        </Frame>
      );

    case "card":
      return (
        <Frame {...props}>
          <rect x="2.8" y="5" width="18.4" height="14" rx="1.6" />
          <path d="M2.8 10h18.4" />
          <path d="M6 15.2h3.5" />
        </Frame>
      );

    case "activity":
      return (
        <Frame {...props}>
          <path d="M3 12h4l2.4-7 5.2 14L17 12h4" />
        </Frame>
      );
  }
}

export function ChevronIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="m6.5 9 5.5 5.5L17.5 9" />
    </Frame>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Frame>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Frame>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" />
      <path d="m15 8 4 4-4 4" />
      <path d="M19 12H9.5" />
    </Frame>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M4 12h16" />
      <path d="m14 6 6 6-6 6" />
    </Frame>
  );
}
