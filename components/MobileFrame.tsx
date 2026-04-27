import type { ReactNode } from 'react'
import clsx from 'clsx'

interface MobileFrameProps {
  children: ReactNode
  className?: string
}

export default function MobileFrame({ children, className }: MobileFrameProps) {
  return (
    <div className="bg-neutral-900 flex items-start justify-center" style={{ height: '100%', overflow: 'hidden' }}>
      <div
        className={clsx(
          'relative w-full max-w-[430px] bg-black overflow-hidden',
          className,
        )}
        style={{ height: '100%' }}
      >
        {children}
      </div>
    </div>
  )
}
