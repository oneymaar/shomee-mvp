import type { ReactNode } from 'react'
import clsx from 'clsx'

interface MobileFrameProps {
  children: ReactNode
  className?: string
}

export default function MobileFrame({ children, className }: MobileFrameProps) {
  return (
    <div className="bg-neutral-900 flex items-start justify-center" style={{ minHeight: '100dvh' }}>
      <div
        className={clsx(
          'relative w-full max-w-[430px] bg-black overflow-hidden',
          className,
        )}
        style={{ minHeight: '100dvh' }}
      >
        {children}
      </div>
    </div>
  )
}
