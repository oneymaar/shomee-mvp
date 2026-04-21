'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'

export default function SplashPage() {
  const router = useRouter()
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    const isStandalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches

    if (!isStandalone) setShowHint(true)

    const timer = setTimeout(() => router.replace('/feed'), 2000)
    return () => clearTimeout(timer)
  }, [router])

  return (
    <div
      className="min-h-screen bg-black flex flex-col items-center justify-center"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <Image
          src="/logo-shomee.png"
          alt="SHOMEE"
          width={160}
          height={180}
          priority
          className="object-contain"
        />
      </motion.div>

      {showHint && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.8 }}
          className="absolute bottom-12 text-white/35 text-[12px] text-center leading-relaxed px-8"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          Pour ajouter SHOMEE sur votre écran d'accueil,{'\n'}
          appuyez sur <span className="text-white/55">Partager</span> puis{' '}
          <span className="text-white/55">Sur l'écran d'accueil</span>
        </motion.p>
      )}
    </div>
  )
}
