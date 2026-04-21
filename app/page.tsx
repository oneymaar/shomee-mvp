'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import ShomeeLogo from '@/components/ShomeeLogo'

export default function SplashPage() {
  const router = useRouter()
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches

    setIsStandalone(standalone)

    if (standalone) {
      // Launched from home screen → go to feed immediately
      router.replace('/feed')
    }
    // In Safari browser → stay on this page so user can share the URL
  }, [router])

  if (isStandalone) return null

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-16"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <ShomeeLogo size={130} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-4 px-8 text-center"
      >
        <button
          onClick={() => router.push('/feed')}
          className="bg-white text-black font-bold text-[16px] px-10 py-3.5 rounded-full active:opacity-80 transition-opacity"
        >
          Découvrir les biens
        </button>
        <p className="text-white/35 text-[12px] leading-relaxed">
          Pour ajouter SHOMEE sur votre écran d'accueil,{'\n'}
          appuyez sur <span className="text-white/55">Partager</span> puis <span className="text-white/55">Sur l'écran d'accueil</span>
        </p>
      </motion.div>
    </div>
  )
}
