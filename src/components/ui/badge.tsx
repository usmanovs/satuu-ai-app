import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground',
      emerald: 'bg-emerald-100 text-emerald-800',
      amber: 'bg-amber-100 text-amber-900',
      blue: 'bg-blue-100 text-blue-800',
      red: 'bg-red-100 text-red-800',
      demo: 'bg-fuchsia-100 text-fuchsia-800',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
