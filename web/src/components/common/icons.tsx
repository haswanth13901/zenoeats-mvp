/**
 * Shared inline icons.
 *
 * Inline rather than an icon package: two paths do not justify a dependency,
 * and `currentColor` plus em sizing means an icon inherits the colour and
 * scale of whatever text it sits beside, from a meal heading down to a row.
 */
export function PencilIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="h-[0.9em] w-[0.9em]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.06 2.44a1.5 1.5 0 0 1 2.12 2.12l-7.7 7.7-2.83.71.71-2.83 7.7-7.7Z" />
      <path d="M10.2 3.3l2.12 2.12" />
    </svg>
  );
}

/** A picture frame. Stands in for a photo nobody has added yet. */
export function PhotoIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="h-[1.1em] w-[1.1em]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.25" />
      <path d="M14 11l-3.5-3.5L4 13" />
    </svg>
  );
}
