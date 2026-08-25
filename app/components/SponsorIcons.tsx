// Inline line-icons for the sponsor console's candy accents. The app ships no
// icon dependency, so these are hand-drawn here and kept local to the sponsor
// surface. Every icon is decoration: aria-hidden, no title, and it inherits
// currentColor so the parent chip decides the tone. Never placed on a number.

import type { ReactNode } from "react";

type IconName =
  | "vault"
  | "coins"
  | "payout"
  | "users"
  | "trophy"
  | "lock"
  | "eye"
  | "fingerprint"
  | "shield"
  | "clock"
  | "plus"
  | "arrow"
  | "eyeOff";

const PATHS: Record<IconName, ReactNode> = {
  vault: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 6.5v2.3M12 15.2v2.3M6.6 12h2.2M15.2 12h2.2" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
      <path d="M5 9c0 1.66 3.13 3 7 3s7-1.34 7-3" />
    </>
  ),
  payout: (
    <>
      <path d="M3 16.5l5.5-5.5 3.5 3.5 7-7" />
      <path d="M15 7.5h4v4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.6a3 3 0 0 1 0 5.5" />
      <path d="M17.6 19c0-2-.7-3.6-1.8-4.5" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4z" />
      <path d="M8 5H5v1a3 3 0 0 0 3 3M16 5h3v1a3 3 0 0 1-3 3" />
      <path d="M12 12v3M9.5 20h5M10.2 20l.4-2.5h2.8l.4 2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2.4" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15" r="1.3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  fingerprint: (
    <>
      <path d="M12 11a2 2 0 0 1 2 2c0 2.6-.8 4.6-.8 4.6" />
      <path d="M12 8a5 5 0 0 1 5 5c0 1-.2 2-.5 3" />
      <path d="M12 5a8 8 0 0 1 8 8" />
      <path d="M4 13a8 8 0 0 1 4-6.9" />
      <path d="M8.2 16.5c-.6-1.1-1-2.2-1-3.5a4.8 4.8 0 0 1 2.9-4.4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.2l2.8 1.8" />
    </>
  ),
  plus: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8.4v7.2M8.4 12h7.2" />
    </>
  ),
  arrow: <path d="M5 12h13M12.5 6l6 6-6 6" />,
  eyeOff: (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.6 5.4A9.7 9.7 0 0 1 12 5.1c6 0 9.5 6.9 9.5 6.9a17 17 0 0 1-2.8 3.6M6.3 6.3A16.8 16.8 0 0 0 2.5 12s3.5 6.9 9.5 6.9a9.3 9.3 0 0 0 3.7-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
};

export function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
