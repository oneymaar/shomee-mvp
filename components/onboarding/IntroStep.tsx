'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'

interface IntroStepProps {
  onStart: () => void
  onQuick: () => void
}

export default function IntroStep({ onStart, onQuick }: IntroStepProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 gap-8">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center"
      >
        <Image
          src="/logo terracotta.png"
          alt="SHOMEE"
          width={90}
          height={100}
          priority
          className="object-contain"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="text-center max-w-[300px]"
      >
        <h1 className="text-[26px] font-bold text-neutral-900 leading-tight tracking-tight">
          Trouvez enfin les biens qui vous correspondent.
        </h1>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col gap-3 w-full"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <button
          onClick={onStart}
          className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white active:opacity-90 transition-opacity"
          style={{ backgroundColor: '#BC4F29' }}
        >
          Commencer
        </button>
        <button
          onClick={onQuick}
          className="w-full py-3.5 rounded-2xl font-medium text-[15px] active:bg-black/5 transition-colors"
          style={{ color: '#BC4F29' }}
        >
          Aller directement sur le feed
        </button>
      </motion.div>
    </div>
  )
}
