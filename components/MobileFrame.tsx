import type { ReactNode } from 'react'
import clsx from 'clsx'

interface MobileFrameProps {
  children: ReactNode
  className?: string
}

export default function MobileFrame({ children, className }: MobileFrameProps) {
  return (
    <div className="flex items-start justify-center overflow-hidden" style={{ height: '100dvh', backgroundColor: '#f5f0e8' }}>
      <div
        className={clsx(
          'relative w-full max-w-[430px] overflow-hidden',
          className,
        )}
        style={{ backgroundColor: '#f5f0e8' }}
        style={{ height: '100dvh' }}
      >
        {children}
      </div>
    </div>
  )
}
