'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'

export default function SplashPage() {
  const router = useRouter()
  const [showHint, setShowHint] = useState(false)
  const [visible, setVisible] = useState(true)

  const navigateToFeed = () => {
    setVisible(false)
  }

  useEffect(() => {
    const isStandalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches

    if (isStandalone) {
      const timer = setTimeout(() => navigateToFeed(), 2000)
      return () => clearTimeout(timer)
    } else {
      setShowHint(true)
    }
  }, [])

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center">
      <AnimatePresence onExitComplete={() => router.replace('/feed')}>
        {visible && (
          <motion.div
            key="splash"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center"
          >
            <Image
              src="/Logo-shomee.png"
              alt="SHOMEE"
              width={160}
              height={180}
              priority
              className="object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {showHint && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: visible ? 1 : 0, y: 0 }}
          transition={{ duration: 0.4, delay: 0.7 }}
          className="absolute bottom-12 flex flex-col items-center gap-4 px-8"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <button
            onClick={navigateToFeed}
            className="bg-white text-black font-bold text-[16px] px-10 py-3.5 rounded-full active:opacity-80 transition-opacity"
          >
            Découvrir les biens
          </button>
          <p className="text-white/35 text-[12px] text-center leading-relaxed">
            Pour ajouter SHOMEE sur votre écran d'accueil,{'\n'}
            appuyez sur <span className="text-white/55">Partager</span> puis{' '}
            <span className="text-white/55">Sur l'écran d'accueil</span>
          </p>
        </motion.div>
      )}
    </div>
  )
}
