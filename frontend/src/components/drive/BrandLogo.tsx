import { cn } from '@/lib/utils'

export function BrandLogo({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200', className)}>
      <svg viewBox="0 0 40 40" className="h-7 w-7 drop-shadow-[0_3px_2px_rgba(5,13,46,0.85)]" role="img" aria-label="MultiDrive logo">
        <path transform="translate(20 20) rotate(-20) skewX(-16) translate(-20 -20)" fill="none" stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" d="M10 29V11L20 22L30 11V29" />
      </svg>
    </div>
  )
}
