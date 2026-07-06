// Small shared components, faithful to the design.
import { useTranslation } from 'react-i18next'
import { buzz } from '../lib/haptics'

export function ScreenTitle({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-5 pt-6 pb-1 lg:px-8">
      <h1 className="text-[28px] font-extrabold tracking-tight lg:text-[26px]">{title}</h1>
      {aside}
    </div>
  )
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10.5 flex-none rounded-full transition-colors ${on ? 'bg-accent' : 'bg-track'} disabled:opacity-50`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-5' : 'left-0.5'}`} />
    </button>
  )
}

export function ProgressBar({ pct, className = 'h-1' }: { pct: number; className?: string }) {
  // A full bar means "all caught up" — switch from accent to green.
  return (
    <div className={`bg-track overflow-hidden rounded-full ${className}`}>
      <div
        className={`h-full rounded-full ${pct >= 100 ? 'bg-green' : 'bg-accent'}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  )
}

/** One star, optionally half-filled (Letterboxd style). */
function Star({ fill, className = '' }: { fill: 0 | 0.5 | 1; className?: string }) {
  return (
    <span className={`relative inline-block ${className}`}>
      <span className="text-star-off">★</span>
      {fill > 0 && (
        <span
          className="text-accent absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: fill === 1 ? '100%' : '50%' }}
        >
          ★
        </span>
      )}
    </span>
  )
}

const starFill = (value: number, i: number): 0 | 0.5 | 1 =>
  value >= i * 2 ? 1 : value === i * 2 - 1 ? 0.5 : 0

/** Read-only star row for grids/cards. `value` is 1-10 (halves supported). */
export function StarRow({ value, className = 'text-[11px]' }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex gap-px leading-none ${className}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} fill={starFill(value, i)} />
      ))}
    </span>
  )
}

export function Stars({
  value,
  onChange,
}: {
  value: number | null // 1-10 on the API side → 5 stars with halves
  onChange?: (v: number | null) => void
}) {
  const { t } = useTranslation()
  const v = value ?? 0
  return (
    <div className="flex items-center gap-0.75 text-base">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="relative">
          <Star fill={starFill(v, i)} />
          {onChange && (
            <>
              {/* Left half → x.5, right half → x. Tapping the current value clears. */}
              <button
                type="button"
                aria-label={`${i - 0.5}★`}
                onClick={() => onChange(v === i * 2 - 1 ? null : i * 2 - 1)}
                className="absolute inset-y-0 left-0 w-1/2"
              />
              <button
                type="button"
                aria-label={`${i}★`}
                onClick={() => onChange(v === i * 2 ? null : i * 2)}
                className="absolute inset-y-0 right-0 w-1/2"
              />
            </>
          )}
        </span>
      ))}
      <span className="text-muted ml-1.5 self-center text-xs font-bold tracking-normal">{t('common.myRating')}</span>
    </div>
  )
}

/** The signature check button — 50px, fills yellow with a glow. */
export function CheckButton({
  checked,
  onClick,
  size = 50,
  busy = false,
}: {
  checked: boolean
  onClick?: () => void
  size?: number
  busy?: boolean
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
          ? () => {
              buzz()
              onClick()
            }
          : undefined
      }
      disabled={busy}
      style={{ width: size, height: size }}
      className={`flex flex-none items-center justify-center rounded-full border-2 font-extrabold transition-all duration-200 ${
        checked
          ? 'bg-accent border-accent text-ink shadow-[0_6px_18px_rgba(255,201,75,.35)]'
          : 'border-border2 text-fade bg-transparent active:scale-95'
      }`}
    >
      <span style={{ fontSize: size * 0.44 }}>✓</span>
    </button>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="border-track border-t-accent h-8 w-8 animate-spin rounded-full border-[3px]" />
    </div>
  )
}
