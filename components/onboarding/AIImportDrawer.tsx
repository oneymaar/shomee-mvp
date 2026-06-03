'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, HelpCircle, Loader2, X } from 'lucide-react'
import { importAIBrief, type ImportResult } from '@/lib/services/aiOnboardingImport'

interface AIImportDrawerProps {
  onClose: () => void
  /** Called when the import succeeded — parent transitions to the recap. */
  onImported: (result: { locationLabel: string; geoResolved: boolean }) => void
}

const PLACEHOLDER = `{
  "locationQuery": "Paris 12 proche métro Nation",
  "propertyTypes": ["appartement"],
  "minRooms": 3,
  "minSurface": 55,
  "maxSurface": null,
  "budgetMin": null,
  "budgetMax": 650000,
  "chipStates": { "Lumineux": 2, "Ascenseur": 2 },
  "customCriteria": [
    { "label": "Vis-à-vis", "state": 3, "polarity": "negative" }
  ]
}`

/**
 * AIImportDrawer is mounted only while visible — parent uses AnimatePresence
 * to drive enter/exit. State (text/error/busy) is therefore guaranteed-fresh
 * on every open without needing a reset effect.
 */
export default function AIImportDrawer({ onClose, onImported }: AIImportDrawerProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus textarea after entrance animation settles
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 280)
    return () => clearTimeout(t)
  }, [])

  // Esc → close (unless busy)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const handleImport = useCallback(async () => {
    if (busy) return
    if (text.trim().length === 0) {
      setError('Collez le brief généré par votre IA avant de continuer.')
      return
    }
    setError(null)
    setBusy(true)
    let res: ImportResult
    try {
      res = await importAIBrief(text)
    } catch (e) {
      console.error('[AIImportDrawer] import threw:', e)
      setBusy(false)
      setError('Erreur inattendue pendant l’import. Réessayez.')
      return
    }
    if (!res.success) {
      setBusy(false)
      setError(res.error)
      return
    }
    onImported({ locationLabel: res.locationLabel, geoResolved: res.geoResolved })
  }, [busy, text, onImported])

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[9998]"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={() => { if (!busy) onClose() }}
      />

      {/* Sheet — slides up, dark theme (AI surface convention) */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
        className="fixed inset-x-0 bottom-0 z-[9999] flex flex-col"
        style={{
          background: '#171717',
          color: '#fafafa',
          maxWidth: 430,
          margin: '0 auto',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '92svh',
          paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.45)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-import-title"
      >
        {/* Grabber */}
        <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
        </div>

        {/* Header */}
        <div className="flex-shrink-0 flex items-start justify-between px-5 pt-3 pb-4">
          <div>
            <h2 id="ai-import-title" className="text-[19px] font-bold tracking-tight">
              Collez votre brief ici
            </h2>
            <p className="text-[13px] mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Généré depuis Claude ou ChatGPT
            </p>
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => { if (!busy) onClose() }}
            disabled={busy}
            className="w-9 h-9 -mt-1 -mr-1 rounded-full flex items-center justify-center transition-colors active:bg-white/10"
            style={{ background: 'rgba(255,255,255,0.06)', opacity: busy ? 0.4 : 1 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Textarea — monospace, dark */}
        <div className="px-5 flex-1 min-h-0 flex flex-col">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError(null) }}
            placeholder={PLACEHOLDER}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="w-full flex-1 min-h-[180px] resize-none rounded-2xl px-3.5 py-3 text-[12.5px] leading-[1.45] outline-none transition-colors"
            style={{
              background: '#0a0a0a',
              color: '#fafafa',
              border: '1px solid rgba(255,255,255,0.1)',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            }}
          />

          {error && (
            <p
              className="mt-3 text-[12.5px] leading-snug"
              style={{ color: '#fca5a5' }}
              role="alert"
            >
              {error}
            </p>
          )}

          {/* Help link + tooltip */}
          <div className="mt-3 relative">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[12px] transition-colors active:opacity-70"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              <HelpCircle size={12} />
              Comment obtenir mon brief&nbsp;?
            </button>

            <AnimatePresence>
              {helpOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute left-0 right-0 bottom-full mb-2 rounded-xl px-3.5 py-2.5 text-[12px] leading-snug shadow-lg"
                  style={{
                    background: '#262626',
                    color: 'rgba(255,255,255,0.85)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  Utilisez le skill <strong>SHOMEE</strong> dans Claude ou ChatGPT.
                  Décrivez votre recherche, le skill produit un brief JSON
                  prêt à coller ici.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* CTA */}
        <div className="flex-shrink-0 px-5 pt-4">
          <button
            type="button"
            onClick={handleImport}
            disabled={busy || text.trim().length === 0}
            className="w-full py-4 rounded-2xl font-semibold text-[15.5px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
            style={{
              backgroundColor: busy || text.trim().length === 0 ? '#7a3a1f' : '#A64B27',
              cursor: busy ? 'progress' : text.trim().length === 0 ? 'default' : 'pointer',
            }}
          >
            {busy ? (
              <>
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  className="inline-flex"
                >
                  <Loader2 size={16} />
                </motion.span>
                Résolution de la localisation…
              </>
            ) : (
              <>
                Importer et continuer
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </>
  )
}
