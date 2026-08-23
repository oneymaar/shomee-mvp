'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'

export default function SplashPage() {
  const router = useRouter()
  const [showHint, setShowHint] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [destination, setDestination] = useState('/onboarding')

  const start = () => { setDestination('/onboarding'); setExiting(true) }
  const goToFeed = () => { setDestination('/feed'); setExiting(true) }

  useEffect(() => {
    // Match body + theme-color to splash background so safe-area zone is terracotta
    document.body.style.backgroundColor = '#A64B27'
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    if (themeMeta) themeMeta.setAttribute('content', '#A64B27')
    return () => {
      document.body.style.backgroundColor = '#FDF5F2'
      if (themeMeta) themeMeta.setAttribute('content', '#000000')
    }
  }, [])

  useEffect(() => {
    // Aucune redirection automatique : l'écran d'accueil (logo + boutons)
    // s'affiche et attend une action explicite de l'utilisateur, quel que
    // soit le contexte (Chrome, Safari ou PWA installée en standalone).
    setShowHint(true)
  }, [])

  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ backgroundColor: '#A64B27' }}
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
            onClick={start}
            className="text-white font-bold text-[16px] px-10 py-3.5 rounded-full active:opacity-80 transition-opacity"
            style={{ backgroundColor: '#FDF5F2', color: '#A64B27' }}
          >
            Commencer
          </button>
          <button
            onClick={goToFeed}
            className="text-white/70 font-medium text-[14px] active:opacity-60 transition-opacity"
          >
            Aller directement sur le feed
          </button>
          {/* Exigé par la vérification Meta Business : le lien doit être
              trouvable depuis la page d'accueil. */}
          <a
            href="/mentions-legales"
            className="text-white/40 text-[11px] active:opacity-60 transition-opacity"
          >
            Mentions légales
          </a>
        </motion.div>
      )}
    </motion.div>
  )
}
