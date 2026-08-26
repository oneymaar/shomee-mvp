'use client'

/**
 * Assistant « Nouveau bien » — trois étapes, toutes réelles.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CE QU'IL Y AVAIT AVANT : une maquette cliquable. Un « 52 % » écrit en dur
 * dès le premier écran, une barre de téléversement animée par un setInterval
 * de deux secondes sans qu'aucun octet ne parte, et une arrivée sur
 * /agent/biens/draft-001/editer — une fiche FICTIVE codée dans le dépôt. Rien
 * n'était créé, d'où le 404 en prévisualisation et le bouton Publier inerte.
 *
 * L'ADRESSE D'ABORD, ET CE N'EST PAS UNE QUESTION D'ERGONOMIE.
 * Le téléversement d'une vidéo exige un `bien_id` pour signer puis confirmer :
 * sans bien en base, aucun envoi n'est possible. Créer le brouillon dès
 * l'étape 1 est donc la condition pour que tout le reste soit vrai.
 *
 * LE POURCENTAGE ARRIVE À LA FIN.
 * « Votre annonce est remplie à 52 % » en ouverture n'avait aucun sens : c'est
 * le RÉSULTAT d'une analyse, pas un point de départ. Il s'affiche maintenant
 * après la lecture de la vidéo, calculé par le serveur, avec ce qui manque
 * nommé — un chiffre sans la liste de ce qu'il reste à faire n'aide personne.
 *
 * L'ÉTAT AFFICHÉ EST L'ÉTAT RÉEL.
 * Octets envoyés, phase en cours, et si ça échoue : la raison et le fait que
 * le brouillon, lui, est déjà enregistré. Une barre qui avance toute seule est
 * pire qu'une absence de barre.
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, UploadCloud, Video, Check, X, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { televerser, ACCEPT } from '@/lib/media/upload'
import { VIDEO_HINT, formatMo } from '@/lib/media/limits'

type Etape = 'adresse' | 'video' | 'resultat'
type Phase = 'attente' | 'envoi' | 'analyse'

interface TagReconnu { label: string; garde: boolean }

/** Les champs qu'aucune vidéo ne peut deviner, et qu'on sait vides à coup sûr. */
const CHAMPS_CLES: Array<{ libelle: string; vide: (b: BienBrut) => boolean }> = [
  { libelle: 'le prix', vide: (b) => !b.price },
  { libelle: 'la surface', vide: (b) => !b.surface },
  { libelle: 'le nombre de pièces', vide: (b) => !b.rooms },
  { libelle: 'le nombre de chambres', vide: (b) => b.bedrooms === null || b.bedrooms === undefined },
  { libelle: 'la description', vide: (b) => !b.description || b.description.trim().length < 40 },
]

interface BienBrut {
  price?: number
  surface?: number
  rooms?: number
  bedrooms?: number | null
  description?: string
  completionRate?: number
  tags?: string[]
}

function enumeration(mots: string[]): string {
  if (mots.length === 0) return ''
  if (mots.length === 1) return mots[0]
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`
}

export default function NouveauBienPage() {
  const router = useRouter()

  const [etape, setEtape] = useState<Etape>('adresse')
  const [erreur, setErreur] = useState<string | null>(null)

  // ── Étape 1 ──
  const [adresse, setAdresse] = useState('')
  const [bienId, setBienId] = useState<string | null>(null)
  const [creation, setCreation] = useState(false)

  // ── Étape 2 ──
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [fichier, setFichier] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('attente')
  const [pourcent, setPourcent] = useState(0)
  const [octets, setOctets] = useState(0)

  // ── Étape 3 ──
  const [completude, setCompletude] = useState<number | null>(null)
  const [tags, setTags] = useState<TagReconnu[]>([])
  const [manques, setManques] = useState<string[]>([])
  const [analyseIndisponible, setAnalyseIndisponible] = useState<string | null>(null)
  const [finalisation, setFinalisation] = useState(false)

  const retour = () => {
    if (etape === 'adresse') { router.push('/agent/biens'); return }
    if (etape === 'video' && phase === 'attente') { setEtape('adresse'); return }
    if (etape === 'resultat' && bienId) { router.push(`/agent/biens/${bienId}/editer`) }
  }

  // ── Étape 1 → crée le bien pour de vrai ────────────────────────────────
  const creerLeBrouillon = async () => {
    if (creation || !adresse.trim()) return
    setCreation(true)
    setErreur(null)
    try {
      const res = await fetch('/api/agent/biens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adresse: adresse.trim() }),
      })
      const corps = (await res.json().catch(() => null)) as { bien_id?: string; error?: string } | null
      if (!res.ok || !corps?.bien_id) throw new Error(corps?.error ?? `Création refusée (HTTP ${res.status}).`)
      setBienId(corps.bien_id)
      setEtape('video')
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Création impossible.')
    } finally {
      setCreation(false)
    }
  }

  // ── Étape 2 → envoi réel, puis analyse ─────────────────────────────────
  const lancerEnvoi = async (f: File) => {
    if (!bienId) return
    setFichier(f)
    setErreur(null)
    setPourcent(0)
    setOctets(0)
    setPhase('envoi')
    const controleur = new AbortController()
    abortRef.current = controleur

    try {
      await televerser({
        file: f,
        type: 'video',
        bienId,
        signal: controleur.signal,
        onProgress: (p, envoyes) => { setPourcent(p); setOctets(envoyes) },
      })
      setPhase('analyse')
      await analyser(bienId)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setPhase('attente')
        setFichier(null)
        return
      }
      setErreur(e instanceof Error ? e.message : 'Envoi impossible.')
      setPhase('attente')
      setFichier(null)
    } finally {
      abortRef.current = null
    }
  }

  const annulerEnvoi = () => abortRef.current?.abort()

  /**
   * L'analyse est un bonus, jamais un verrou : si elle échoue (clé absente,
   * service indisponible), la vidéo est déjà enregistrée et l'agent continue.
   */
  const analyser = async (id: string) => {
    let libelles: string[] = []
    try {
      const res = await fetch(`/api/biens/${id}/analyze-video`, { method: 'POST' })
      if (res.ok) {
        const data = (await res.json()) as { tags?: Array<{ label: string }> }
        libelles = (data.tags ?? []).map((t) => t.label)
      } else {
        const corps = (await res.json().catch(() => null)) as { error?: string } | null
        setAnalyseIndisponible(corps?.error ?? "L'analyse n'a pas pu s'exécuter.")
      }
    } catch {
      setAnalyseIndisponible("L'analyse n'a pas pu s'exécuter.")
    }
    setTags(libelles.map((label) => ({ label, garde: true })))

    // La complétude et les manques viennent de la base, pas d'une estimation.
    try {
      const res = await fetch(`/api/biens/${id}`)
      if (res.ok) {
        const bien = (await res.json()) as BienBrut
        setCompletude(typeof bien.completionRate === 'number' ? Math.round(bien.completionRate * 100) : null)
        setManques(CHAMPS_CLES.filter((c) => c.vide(bien)).map((c) => c.libelle))
      }
    } catch { /* la fiche s'ouvrira quand même */ }

    setEtape('resultat')
  }

  // ── Étape 3 → on garde les pastilles cochées, puis on ouvre la fiche ───
  const ouvrirLaFiche = async () => {
    if (!bienId || finalisation) return
    setFinalisation(true)
    const gardes = tags.filter((t) => t.garde).map((t) => t.label)
    if (tags.length > 0 && gardes.length !== tags.length) {
      try {
        await fetch(`/api/biens/${bienId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: gardes }),
        })
      } catch { /* on n'empêche pas l'agent d'avancer pour ça */ }
    }
    router.push(`/agent/biens/${bienId}/editer`)
  }

  const passerLaVideo = () => { if (bienId) router.push(`/agent/biens/${bienId}/editer`) }

  const rang = etape === 'adresse' ? 0 : etape === 'video' ? 1 : 2
  const titreEtape = ['Étape 1 sur 3 — Adresse', 'Étape 2 sur 3 — Vidéo', 'Étape 3 sur 3 — Ce qui a été reconnu'][rang]

  return (
    <main className="px-5 pt-safe-page pb-[132px] overflow-x-hidden">
      <header className="flex items-center gap-2 mb-4 -ml-2">
        <button type="button" onClick={retour} aria-label="Retour"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#0a0a0a] active:bg-black/5">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-[17px] font-semibold text-[#0a0a0a]">Nouveau bien</h1>
      </header>

      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <i key={i} className={clsx('h-[3px] flex-1 rounded-full',
            i < rang ? 'bg-[#0a0a0a]/35' : i === rang ? 'bg-[#0a0a0a]' : 'bg-gray-200')} />
        ))}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-[1.5px] text-gray-500 mt-2.5 mb-6">{titreEtape}</p>

      <AnimatePresence mode="wait">
        <motion.div key={etape}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}>

          {/* ── 1. ADRESSE ─────────────────────────────────────────────── */}
          {etape === 'adresse' && (
            <section>
              <h2 className="text-[22px] font-bold leading-tight tracking-[-0.3px]">Où se trouve le bien&nbsp;?</h2>
              <p className="text-[13.5px] leading-relaxed text-gray-500 mt-2">
                L&apos;adresse exacte reste dans votre back-office. Les acquéreurs ne voient que le quartier.
              </p>
              <input
                value={adresse}
                onChange={(e) => setAdresse(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void creerLeBrouillon() }}
                placeholder="12 rue de Cîteaux, 75012 Paris"
                autoFocus
                className="w-full mt-5 bg-white border-[1.5px] border-gray-200 rounded-[14px] px-4 py-3.5 text-[15px] outline-none focus:border-[#0a0a0a] focus:ring-4 focus:ring-black/5"
              />
              <div className="mt-4 flex gap-3 items-center border border-dashed border-gray-300 rounded-[14px] px-3.5 py-3">
                <span className="flex-none w-[30px] h-[30px] rounded-full bg-[#0a0a0a] text-white text-[13px] font-bold flex items-center justify-center">C</span>
                <p className="text-[12.5px] leading-snug text-gray-500">
                  Vous avez le mandat sous les yeux&nbsp;? <b className="text-[#0a0a0a] font-semibold">Dictez-le à Claude ou ChatGPT</b> — la fiche arrive déjà remplie.
                </p>
              </div>
            </section>
          )}

          {/* ── 2. VIDÉO ───────────────────────────────────────────────── */}
          {etape === 'video' && phase === 'attente' && (
            <section>
              <h2 className="text-[22px] font-bold leading-tight tracking-[-0.3px]">La visite filmée.</h2>
              <p className="text-[13.5px] leading-relaxed text-gray-500 mt-2">
                C&apos;est elle qui fait exister le bien dans le feed&nbsp;: sans vidéo, il ne peut pas être publié.
              </p>
              <div
                onClick={() => inputRef.current?.click()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f) void lancerEnvoi(f)
                }}
                onDragOver={(e) => e.preventDefault()}
                className="mt-5 border-2 border-dashed border-gray-300 rounded-[18px] bg-white py-11 px-5 text-center cursor-pointer active:bg-gray-50 transition-colors"
              >
                <div className="w-[54px] h-[54px] rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3.5">
                  <UploadCloud size={25} className="text-[#0a0a0a]" />
                </div>
                <p className="text-[15px] font-semibold">Déposer une vidéo</p>
                <p className="text-[12px] text-gray-500 mt-1">{VIDEO_HINT}</p>
              </div>
              <input ref={inputRef} type="file" accept={ACCEPT.video} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void lancerEnvoi(f); e.target.value = '' }} />
              <p className="text-[12px] text-gray-500 mt-3.5 px-1">
                Filmée au téléphone, à hauteur d&apos;œil, sans commentaire&nbsp;: c&apos;est le format qui marche.
              </p>
            </section>
          )}

          {/* ── 2 bis. ENVOI EN COURS ──────────────────────────────────── */}
          {etape === 'video' && phase !== 'attente' && fichier && (
            <section>
              <h2 className="text-[22px] font-bold leading-tight tracking-[-0.3px]">
                {phase === 'envoi' ? 'Envoi en cours.' : 'Lecture de la vidéo.'}
              </h2>
              <p className="text-[13.5px] leading-relaxed text-gray-500 mt-2">
                {phase === 'envoi'
                  ? 'Le brouillon est déjà enregistré : vous ne perdrez rien si l’envoi échoue.'
                  : 'SHOMEE repère ce qu’on voit dans le bien. Quelques secondes.'}
              </p>

              <div className="mt-5 bg-white border border-gray-200 rounded-[18px] p-4">
                <div className="flex gap-3 items-center">
                  <div className="w-[46px] h-[46px] rounded-[11px] bg-[#0a0a0a] flex items-center justify-center flex-none">
                    <Video size={21} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold truncate">{fichier.name}</p>
                    <p className="text-[12px] text-gray-500 mt-0.5">{formatMo(fichier.size)}</p>
                  </div>
                  {phase === 'envoi' && (
                    <button type="button" onClick={annulerEnvoi}
                      className="ml-auto text-[12.5px] font-semibold text-gray-500 underline">Annuler</button>
                  )}
                </div>

                <div className="h-1.5 rounded-full bg-gray-100 mt-4 overflow-hidden">
                  <div className="h-full bg-[#0a0a0a] rounded-full transition-[width] duration-200"
                    style={{ width: `${phase === 'analyse' ? 100 : pourcent}%` }} />
                </div>
                <div className="flex justify-between text-[12px] mt-2">
                  <span className="font-semibold">
                    {phase === 'envoi' ? `Téléversement ${pourcent} %` : 'Envoi terminé'}
                  </span>
                  <span className="text-gray-500">
                    {phase === 'envoi' ? `${formatMo(octets)} sur ${formatMo(fichier.size)}` : formatMo(fichier.size)}
                  </span>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-2.5">
                  <Etat fait libelle="Fiche créée en brouillon" numero="1" />
                  <Etat fait={phase === 'analyse'} actif={phase === 'envoi'} libelle="Téléversement de la vidéo" numero="2" />
                  <Etat actif={phase === 'analyse'} libelle="Analyse par SHOMEE" numero="3" />
                </div>
              </div>
            </section>
          )}

          {/* ── 3. RÉSULTAT ────────────────────────────────────────────── */}
          {etape === 'resultat' && (
            <section>
              <div className="flex items-center gap-3.5 bg-white border border-gray-200 rounded-[18px] p-4">
                <Anneau valeur={completude} />
                <div>
                  <p className="text-[13.5px] font-semibold leading-snug">
                    {completude === null ? 'Fiche créée.' : `Votre fiche est remplie à ${completude} %.`}
                  </p>
                  <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
                    Calculé sur les 15 champs clés, après lecture de la vidéo.
                  </p>
                </div>
              </div>

              {analyseIndisponible && (
                <p className="text-[12.5px] text-gray-500 mt-3.5 leading-snug">
                  La vidéo est bien enregistrée, mais l&apos;analyse n&apos;a pas pu s&apos;exécuter&nbsp;: {analyseIndisponible} Vous pouvez la relancer depuis la fiche.
                </p>
              )}

              {tags.length > 0 && (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-[1.5px] text-gray-500 mt-6 mb-2.5">
                    Reconnu dans la vidéo — touchez pour retirer
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((t, i) => (
                      <button key={t.label} type="button"
                        onClick={() => setTags((prev) => prev.map((x, j) => (j === i ? { ...x, garde: !x.garde } : x)))}
                        className={clsx(
                          'border rounded-full pl-2.5 pr-3 py-1.5 text-[12.5px] flex items-center gap-1.5 transition-opacity',
                          t.garde ? 'bg-white border-gray-200' : 'bg-white border-gray-200 opacity-40 line-through',
                        )}>
                        {t.garde
                          ? <Check size={13} className="text-[#1f9254]" strokeWidth={3} />
                          : <X size={13} className="text-gray-400" strokeWidth={3} />}
                        {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {manques.length > 0 && (
                <div className="mt-5 rounded-[14px] px-3.5 py-3" style={{ backgroundColor: '#FFF8E9', border: '1px solid #F0E2C0' }}>
                  <p className="text-[12.5px] font-semibold mb-1">Il manque encore</p>
                  <p className="text-[12.5px] leading-snug" style={{ color: '#7a6a45' }}>
                    {enumeration(manques)} — {manques.length > 1 ? 'des champs' : 'un champ'} qu&apos;aucune vidéo ne peut deviner.
                  </p>
                </div>
              )}
            </section>
          )}
        </motion.div>
      </AnimatePresence>

      {erreur && (
        <p className="text-[12.5px] mt-4 leading-snug" style={{ color: '#B0442C' }}>{erreur}</p>
      )}

      {/* ── Barre d'action ─────────────────────────────────────────────── */}
      <div className="fixed left-0 right-0 bottom-0 z-40 bg-white border-t border-gray-200 px-5 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
        {etape === 'adresse' && (
          <button type="button" onClick={() => { void creerLeBrouillon() }} disabled={!adresse.trim() || creation}
            className="w-full h-[50px] rounded-[14px] bg-[#0a0a0a] text-white text-[14.5px] font-semibold disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2">
            {creation ? <><Loader2 size={17} className="animate-spin" />Création…</> : 'Continuer'}
          </button>
        )}
        {etape === 'video' && phase === 'attente' && (
          <>
            <button type="button" disabled
              className="w-full h-[50px] rounded-[14px] bg-gray-200 text-gray-400 text-[14.5px] font-semibold">
              Continuer
            </button>
            <button type="button" onClick={passerLaVideo}
              className="w-full h-[46px] text-[14px] font-semibold text-[#0a0a0a]">
              Ajouter la vidéo plus tard
            </button>
          </>
        )}
        {etape === 'video' && phase !== 'attente' && (
          <button type="button" disabled
            className="w-full h-[50px] rounded-[14px] bg-gray-200 text-gray-400 text-[14.5px] font-semibold">
            {phase === 'envoi' ? 'Envoi en cours…' : 'Analyse en cours…'}
          </button>
        )}
        {etape === 'resultat' && (
          <button type="button" onClick={() => { void ouvrirLaFiche() }} disabled={finalisation}
            className="w-full h-[50px] rounded-[14px] bg-[#0a0a0a] text-white text-[14.5px] font-semibold disabled:bg-gray-300">
            {finalisation ? 'Ouverture…' : 'Compléter la fiche →'}
          </button>
        )}
      </div>
    </main>
  )
}

// ─── Petites briques ───────────────────────────────────────────────────────

function Etat({ libelle, numero, fait, actif }: { libelle: string; numero: string; fait?: boolean; actif?: boolean }) {
  return (
    <div className={clsx('flex gap-2.5 items-center text-[13px]', !fait && !actif && 'text-gray-400')}>
      <span className={clsx('w-[17px] h-[17px] rounded-full flex-none flex items-center justify-center text-[9.5px] font-bold text-white',
        fait ? 'bg-[#1f9254]' : actif ? 'bg-[#0a0a0a]' : 'bg-gray-200 text-gray-500')}>
        {fait ? '✓' : numero}
      </span>
      {libelle}
    </div>
  )
}

/** Anneau de complétude — la circonférence exacte évite un remplissage faux. */
function Anneau({ valeur }: { valeur: number | null }) {
  const rayon = 15.5
  const circonference = 2 * Math.PI * rayon
  const rempli = valeur === null ? 0 : (Math.max(0, Math.min(100, valeur)) / 100) * circonference
  return (
    <div className="relative w-[60px] h-[60px] flex-none">
      <svg viewBox="0 0 36 36" width="60" height="60">
        <circle cx="18" cy="18" r={rayon} fill="none" stroke="#EDEAE6" strokeWidth="4" />
        <circle cx="18" cy="18" r={rayon} fill="none" stroke="#0a0a0a" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${rempli} ${circonference}`} transform="rotate(-90 18 18)" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[15.5px] font-bold">
        {valeur === null ? '—' : `${valeur}%`}
      </div>
    </div>
  )
}
