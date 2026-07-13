import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactElement } from 'react';

import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
    'inline-flex items-center justify-center gap-2 font-ui text-sm tracking-widest uppercase border transition-colors disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                default: 'border-gilt text-gilt hover:bg-gilt/10',
                destructive:
                    'border-old-blood-foreground text-old-blood-foreground hover:bg-old-blood/10',
                ghost: 'border-transparent text-veil-foreground hover:bg-veil/10',
            },
            size: {
                default: 'px-6 py-2',
                sm: 'px-4 py-1.5 text-xs',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    },
);

export interface ButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {}

export function Button({
    className,
    variant,
    size,
    type = 'button',
    ...props
}: ButtonProps): ReactElement {
    return (
        <button
            type={type}
            className={cn(buttonVariants({ variant, size }), className)}
            {...props}
        />
    );
}
