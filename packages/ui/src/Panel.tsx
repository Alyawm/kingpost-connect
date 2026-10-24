import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex h-full min-h-0 flex-col', className)} {...rest} />;
}

export function PanelHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex h-9 shrink-0 items-center justify-between border-b border-edge px-3',
        className,
      )}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h2>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-auto p-3', className)} {...rest} />;
}
