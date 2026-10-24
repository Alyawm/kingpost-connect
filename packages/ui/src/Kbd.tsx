import type { ReactNode } from 'react';

/** Renders a keyboard shortcut such as "Ctrl+K" as individual key caps. */
export function Kbd({ children }: { children: string | ReactNode }) {
  const keys = typeof children === 'string' ? children.split('+') : [children];
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key, index) => (
        <kbd
          key={index}
          className="rounded border border-edge bg-surface-2 px-1 font-mono text-[10px] leading-4 text-fg-muted"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
