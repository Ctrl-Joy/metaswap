import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'tint' | 'secondary' | 'outline' | 'ghost' | 'critical' | 'warning'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-fill text-white hover:bg-accent-fill-hover disabled:bg-surface-3 disabled:text-text-3',
  tint: 'bg-accent-tint text-accent hover:bg-accent-tint-hover disabled:bg-surface-3 disabled:text-text-3',
  secondary: 'bg-surface-3 text-text-1 hover:bg-surface-3-hover disabled:text-text-3',
  outline: 'border border-border bg-transparent text-text-1 hover:bg-surface-2 disabled:text-text-3',
  ghost: 'bg-transparent text-text-2 hover:bg-surface-3 hover:text-text-1 disabled:text-text-3',
  critical: 'bg-critical-tint text-critical hover:brightness-110 disabled:bg-surface-3 disabled:text-text-3',
  warning: 'bg-warning-tint text-warning hover:brightness-110 disabled:bg-surface-3 disabled:text-text-3',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-body-3 gap-1.5 rounded-full',
  md: 'h-10 px-4 text-body-2 gap-2 rounded-full',
  lg: 'h-12 px-5 text-body-1 gap-2 rounded-2xl',
  xl: 'h-[56px] px-6 text-body-1 gap-2 rounded-2xl',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export function buttonClass({ variant = 'primary', size = 'md', fullWidth }: Pick<ButtonProps, 'variant' | 'size' | 'fullWidth'> = {}) {
  return cn(
    'inline-flex select-none items-center justify-center font-semibold whitespace-nowrap transition-[background-color,color,transform,filter] duration-150 ease-standard active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
  )
}

/** The one button. Variants follow design-tokens.md §10.3 (accent fill CTA, tint, surface-3 secondary). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, fullWidth, leftIcon, rightIcon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClass({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 18} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  )
})

export function ButtonLink({ variant = 'primary', size = 'md', fullWidth, className, ...rest }: LinkProps & Pick<ButtonProps, 'variant' | 'size' | 'fullWidth'>) {
  return <Link className={cn(buttonClass({ variant, size, fullWidth }), className)} {...rest} />
}

/** Square/round icon-only button (40px default hit area). */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 32 | 36 | 40 }>(
  function IconButton({ label, size = 40, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full text-text-2 transition-colors duration-150 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40',
          size === 32 ? 'size-8' : size === 36 ? 'size-9' : 'size-10',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    )
  },
)
