import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
  {
    variants: {
      variant: {
        default: 'border-steel-600 bg-steel-800 text-steel-200',
        ok:    'border-signal-ok/40    bg-signal-ok/10    text-signal-ok',
        warn:  'border-signal-warn/40  bg-signal-warn/10  text-signal-warn',
        fault: 'border-signal-fault/40 bg-signal-fault/10 text-signal-fault',
        info:  'border-signal-info/40  bg-signal-info/10  text-signal-info',
        agni:  'border-agni-orange/40  bg-agni-orange/10  text-agni-orange',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
