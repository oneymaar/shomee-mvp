'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'

export default function SplashPage() {
  const router = useRouter()
  const [showHint, setShowHint] = useState(false)
  const [exiting, setExiting] = useState(false)

  const navigateToFeed = () => setExiting(true)
  const destination = '/onboarding'

  useEffect(() => {
    // Match body + theme-color to splash background so safe-area zone is terracotta
    document.body.style.backgroundColor = '#914E3C'
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    if (themeMeta) themeMeta.setAttribute('content', '#914E3C')
    return () => {
      document.body.style.backgroundColor = '#f5f0e8'
      if (themeMeta) themeMeta.setAttribute('content', '#000000')
    }
  }, [])

  useEffect(() => {
    const isStandalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches

    if (isStandalone) {
      const timer = setTimeout(navigateToFeed, 2000)
      return () => clearTimeout(timer)
    } else {
      setShowHint(true)
    }
  }, [])

  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ backgroundColor: '#914E3C' }}
      animate={{ opacity: exiting ? 0 : 1 }}
      initial={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      onAnimationComplete={() => { if (exiting) router.replace(destination) }}
    >
      <motion.div
        initial={{ scale: 1, opacity: 1 }}
        animate={{ scale: exiting ? 0.92 : 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <Image
          src="/logo blanc.png"
          alt="SHOMEE"
          width={160}
          height={180}
          priority
          className="object-contain"
        />
      </motion.div>

      {showHint && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: exiting ? 0 : 1, y: 0 }}
          transition={{ duration: 0.4, delay: exiting ? 0 : 0.7 }}
          className="absolute bottom-12 flex flex-col items-center gap-4 px-8"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <button
            onClick={navigateToFeed}
            className="text-white font-bold text-[16px] px-10 py-3.5 rounded-full active:opacity-80 transition-opacity"
            style={{ backgroundColor: '#f5f0e8', color: '#914E3C' }}
          >
            Commencer
          </button>
          <p className="text-white/55 text-[12px] text-center leading-relaxed">
            Pour ajouter SHOMEE sur votre écran d'accueil,{'\n'}
            appuyez sur <span className="text-white/75">Partager</span> puis{' '}
            <span className="text-white/75">Sur l'écran d'accueil</span>
          </p>
        </motion.div>
      )}
    </motion.div>
  )
}
