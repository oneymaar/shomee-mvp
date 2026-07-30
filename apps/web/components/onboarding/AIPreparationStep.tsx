'use client'

/**
 * Écran de chargement de l'onboarding web.
 *
 * Jumeau web du composant natif
 * `apps/mobile/src/components/onboarding/SearchStagingLoader.tsx` : même fond
 * crème plat, même loader de marque animé, une seule phrase à la fois au
 * centre, puis l'annonce du nombre de biens. Les deux écrans doivent rester
 * identiques à l'œil — c'est le seul écran de chargement que voit un
 * utilisateur venu d'un lien LLM (parcours teaser S9), juste avant la
 * première vidéo.
 *
 * Ce composant garde en plus deux responsabilités propres au web :
 *   1. le pré-chargement de /api/feed/generate, déposé dans sessionStorage
 *      sous PREFETCH_KEY pour que /feed n'ait pas à refaire l'appel (= un
 *      seul écran de chargement dans tout le parcours) ;
 *   2. le résumé du brief LLM (prop `summary`), ancré en HAUT de l'écran —
 *      jamais par-dessus la vidéo.
 *
 * Séquencement, repris tel quel du natif : la DERNIÈRE étape absorbe
 * l'attente du moteur. Les trois premières défilent à cadence fixe ; la
 * quatrième reste affichée jusqu'à ce que la réponse arrive (avec un
 * garde-fou de 20 s pour qu'un backend muet ne bloque jamais l'écran).
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSearchStore } from '@/lib/searchStore'
import { apiFetch } from '@/lib/apiFetch'
import ShomeeLoader from '@/components/ShomeeLoader'
import type { BriefSummary } from './briefSummary'

// Clé sessionStorage où l'AIPreparationStep dépose le feed pré-généré
// que la page /feed lira en priorité (évite le second loader).
const PREFETCH_KEY = 'shomee:pregen-feed'

const ACCENT = '#A64B27'
const BG = '#FDF5F2'

/** Les phrases. Le « … » est ajouté à l'affichage, jamais dans la chaîne. */
const STEPS = [
  'Analyse de votre zone idéale',
  'Calibrage du budget',
  'Profil de recherche',
  'Sélection de vos biens',
]

/* Rythme — identique au natif. */
const ENTER = 240
const HOLD = 1000
const EXIT = 220
const FINAL_IN = 240
const FINAL_HOLD = 950

/** Garde-fou : au-delà, on n'attend plus le moteur et on enchaîne. */
const ENGINE_CAP = 20000

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface AIPreparationStepProps {
  onReady: () => void
  /**
   * S9 — résumé du brief LLM, ancré en HAUT de l'écran pendant le chargement.
   * Absent dans le tunnel classique : l'utilisateur vient de saisir lui-même
   * ses critères, les lui relire n'apporte rien.
   */
  summary?: BriefSummary | null
}

export default function AIPreparationStep({ onReady, summary }: AIPreparationStepProps) {
  const { completeOnboarding } = useSearchStore()
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<{ count: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    /* ── 1. Le moteur : pré-fetch /api/feed/generate ────────────────────
       Renvoie le nombre de biens (0 = rien à annoncer). Il tourne en
       parallèle de l'animation ; c'est la dernière étape qui l'attend. */
    const s = useSearchStore.getState()
    const hasBrief =
      !!(s.minSurface || s.maxSurface || s.budgetMin || s.budgetMax ||
         s.minRooms || s.maxRooms || s.minBedrooms || s.maxBedrooms ||
         (s.propertyTypes?.length ?? 0) > 0 ||
         Object.values(s.chipStates ?? {}).some((v) => v > 0) ||
         (s.customCriteria?.length ?? 0) > 0 ||
         (s.selectedArrIds?.length ?? 0) > 0 ||
         (s.selectedCommuneIds?.length ?? 0) > 0 ||
         (s.selectedQuartierIds?.length ?? 0) > 0 ||
         (s.selectedIrisIds?.length ?? 0) > 0)

    let runP: Promise<number> = Promise.resolve(0)

    if (hasBrief) {
      const briefBody = {
        minSurface: s.minSurface,
        maxSurface: s.maxSurface,
        budgetMin: s.budgetMin,
        budgetMax: s.budgetMax,
        minRooms: s.minRooms,
        maxRooms: s.maxRooms,
        minBedrooms: s.minBedrooms,
        maxBedrooms: s.maxBedrooms,
        propertyTypes: s.propertyTypes,
        chipStates: s.chipStates,
        customCriteria: s.customCriteria,
        arrondissementIds: s.selectedArrIds,
        communeIds: s.selectedCommuneIds,
        quartierIds: s.selectedQuartierIds,
        irisIds: s.selectedIrisIds,
      }
      try { sessionStorage.removeItem(PREFETCH_KEY) } catch {}
      runP = apiFetch('/api/feed/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(briefBody),
      })
        .then((r) => r.json())
        .then((data: unknown) => {
          if (Array.isArray(data) && data.length > 0) {
            try {
              sessionStorage.setItem(PREFETCH_KEY, JSON.stringify(data))
            } catch {
              // sessionStorage pleine ou indisponible — /feed retombera
              // sur son fetch habituel.
            }
            return data.length
          }
          return 0
        })
        .catch(() => 0) // /feed fera son propre fetch en fallback
    }

    /* ── 2. L'animation ────────────────────────────────────────────────
       Trois phrases à cadence fixe, la quatrième absorbe l'attente. */
    const finish = () => {
      if (cancelled) return
      completeOnboarding()
      onReady()
    }

    const seq = async () => {
      for (let i = 0; i < STEPS.length; i += 1) {
        if (cancelled) return
        setIndex(i)
        const dernier = i === STEPS.length - 1
        if (!dernier) {
          await wait(ENTER + HOLD + EXIT)
          continue
        }
        // Dernière phrase : on attend le moteur (plafonné), jamais moins
        // que la durée d'affichage normale d'une étape.
        const count = (await Promise.all([
          Promise.race([runP, wait(ENGINE_CAP).then(() => 0)]),
          wait(ENTER + HOLD),
        ]))[0]
        if (cancelled) return
        if (count > 0) {
          setDone({ count })
          await wait(FINAL_IN + FINAL_HOLD)
        }
        finish()
      }
    }

    // Le lancement passe par une microtâche : interdit de poser un setState
    // dans le corps synchrone d'un effet (react-hooks/set-state-in-effect).
    queueMicrotask(() => { if (!cancelled) void seq() })

    return () => { cancelled = true }
  }, [completeOnboarding, onReady])

  return (
    <div
      className="relative flex flex-col items-center justify-center h-full px-8 text-center"
      style={{ background: BG }}
    >
      {/* S9 — résumé du brief, partie HAUTE de l'écran. Positionné en ABSOLU
          à dessein : la ligne de chargement ci-dessous ne bouge pas d'un
          pixel par rapport au tunnel classique. C'est ici, et nulle part
          ailleurs, qu'on montre le lien entre la conversation LLM et SHOMEE :
          la première vidéo, elle, s'affiche nue. */}
      {summary && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute left-0 right-0 px-6 flex flex-col items-center gap-1.5"
          style={{ top: 'max(env(safe-area-inset-top), 20px)' }}
        >
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: ACCENT, opacity: 0.75 }}
          >
            Votre recherche
          </p>
          {summary.zone && (
            <p className="text-[15px] font-semibold text-neutral-900 leading-snug max-w-[300px]">
              {summary.zone}
            </p>
          )}
          {(summary.bien || summary.budget) && (
            <p className="text-[12.5px] text-neutral-600 leading-snug max-w-[300px]">
              {[summary.bien, summary.budget].filter(Boolean).join('  ·  ')}
            </p>
          )}
          {summary.criteres.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5 max-w-[320px] mt-1">
              {summary.criteres.map((c) => (
                <span
                  key={c}
                  className="px-2.5 py-1 rounded-full text-[11.5px] font-medium border"
                  style={{ background: '#fdf0ed', color: '#9b4a2e', borderColor: '#e8907a' }}
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Une seule ligne au centre : le loader de marque + la phrase en
          cours, remplacée par l'annonce du résultat à la fin. */}
      <div className="h-8 flex items-center justify-center w-full">
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div
              key="resultat"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: FINAL_IN / 1000, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-2.5"
            >
              <span
                className="w-[26px] h-[26px] rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: ACCENT }}
              >
                <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                  <path
                    d="M1 4.5L4.5 8L11 1"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="text-[17px] font-semibold text-neutral-900">
                <span style={{ color: ACCENT, fontWeight: 800 }}>{done.count}</span> biens trouvés
              </span>
            </motion.div>
          ) : (
            <motion.div
              key={`etape-${index}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: ENTER / 1000, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-2.5"
            >
              <ShomeeLoader size={26} />
              <span className="text-[16px] font-medium" style={{ color: '#78716c' }}>
                {STEPS[index]}…
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
