import type { ReactNode } from 'react'
import clsx from 'clsx'

interface MobileFrameProps {
  children: ReactNode
  className?: string
}

export default function MobileFrame({ children, className }: MobileFrameProps) {
  return (
    <div className="min-h-screen bg-neutral-900 flex items-start justify-center">
      <div
        className={clsx(
          'relative w-full max-w-[430px] min-h-screen bg-black overflow-hidden',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
