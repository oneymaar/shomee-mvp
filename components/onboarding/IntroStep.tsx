'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'

interface IntroStepProps {
  onStart: () => void
  onQuick: () => void
}

export default function IntroStep({ onStart, onQuick }: IntroStepProps) {
  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pt-16 pb-10">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-3"
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

      {/* Main content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center text-center gap-5 max-w-[300px]"
      >
        {/* Floating dots decoration */}
        <div className="flex gap-1.5 mb-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="rounded-full"
              style={{ width: 6, height: 6, background: '#914E3C', opacity: 0.15 + i * 0.2 }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 1.8, delay: i * 0.25, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>

        <h1 className="text-[26px] font-bold text-neutral-900 leading-tight tracking-tight">
          Trouvez enfin les biens qui vous correspondent vraiment.
        </h1>

        <p className="text-[15px] text-neutral-500 leading-relaxed">
          Décrivez votre projet. SHOMEE construit votre sélection personnalisée.
        </p>
      </motion.div>

      {/* CTAs */}
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
          style={{ backgroundColor: '#914E3C' }}
        >
          Commencer
        </button>
        <button
          onClick={onQuick}
          className="w-full py-3.5 rounded-2xl font-medium text-[15px] active:bg-black/5 transition-colors"
          style={{ color: '#914E3C' }}
        >
          Tester rapidement
        </button>
      </motion.div>
    </div>
  )
}
