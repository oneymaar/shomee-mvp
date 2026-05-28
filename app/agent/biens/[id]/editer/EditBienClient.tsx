'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, Eye, ChevronDown, Plus, X, RefreshCw, Trash2, Video,
  Sparkles, MapPin, Image as ImageIcon, Cable, Globe,
} from 'lucide-react'
import clsx from 'clsx'
import type { Property, DpeRating, MandatType } from '@/lib/types'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'
import MediaUploader from '@/components/agent/MediaUploader'
import VideoChapterEditor, { type Chapter } from '@/components/agent/VideoChapterEditor'

const ALL_FEATURES = [
  'Ascenseur', 'Cave', 'Parking', 'Balcon', 'Terrasse', 'Gardien',
  'Parquet', 'Cheminée', 'Double vitrage', 'Digicode', 'Jardin',
  'Grenier', 'Piscine', 'Climatisation', 'VMC', 'Domotique', 'Interphone',
]
const ANNEX_TYPES = ['Balcon', 'Terrasse', 'Parking', 'Cave', 'Jardin', 'Grenier', 'Piscine']
const COUNTABLE_TYPES = ANNEX_TYPES

const DPE_OPTIONS: DpeRating[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const DPE_COLORS: Record<DpeRating, string> = {
  A: '#309630', B: '#59B340', C: '#C3D635',
  D: '#F2CA00', E: '#F49B14', F: '#E8601A', G: '#C82020',
}

const MANDAT_OPTIONS: Array<{ value: MandatType; label: string }> = [
  { value: 'SIMPLE',   label: 'Simple' },
  { value: 'EXCLUSIF', label: 'Exclusif' },
]

// Mock IRIS suggestions for the demo
const QUARTIER_OPTIONS = [
  'Faubourg-du-Roule — Madeleine',
  'Champs-Élysées — Triangle d\'or',
  'Saint-Honoré — Élysée',
]

const TAGS_FROM_VIDEO = new Set([
  'Séjour orienté sud',
  'Pas de vis-à-vis',
  'Hauteur sous plafond > 3m',
  'Chambres sur cour',
  'Luminosité excellente',
])

// Mocked chapters used as the initial state — to be replaced by AI-analysed
// output once that pipeline is wired up.
const INITIAL_CHAPTERS: Chapter[] = [
  { id: 'c1', label: 'Hall',              startSec: 0  },
  { id: 'c2', label: 'Salon traversant',  startSec: 8  },
  { id: 'c3', label: 'Cuisine',           startSec: 22 },
  { id: 'c4', label: 'Chambre parentale', startSec: 32 },
  { id: 'c5', label: 'Salle de bain',     startSec: 40 },
]

type SectionKey =
  | 'general' | 'features' | 'specs' | 'composition' | 'copro'
  | 'energy' | 'finance' | 'annonce' | 'medias' | 'mandat'

export default function EditBienClient({ initialProperty }: { initialProperty: Property }) {
  const router = useRouter()
  const [form, setForm] = useState<Property>(initialProperty)
  const [openSection, setOpenSection] = useState<SectionKey | null>('general')
  const [previewOpen, setPreviewOpen] = useState(false)

  // Extra form state (not in Property model)
  const [displayAddress, setDisplayAddress] = useState(true)
  const [displayPrice, setDisplayPrice]   = useState(true)
  const [quartier, setQuartier]            = useState<string>(QUARTIER_OPTIONS[0])
  const [propertyType, setPropertyType]    = useState<'appartement' | 'maison' | 'loft' | 'atelier'>('appartement')
  const [featureCounts, setFeatureCounts]  = useState<Record<string, number>>({})
  const [annexSurfaces, setAnnexSurfaces]  = useState<Record<string, number>>({})
  const [featurePickerOpen, setFeaturePickerOpen] = useState(false)
  const [tagDraft, setTagDraft]            = useState('')
  const [annoncePrefix, setAnnoncePrefix]  = useState('')
  const [annonceSuffix, setAnnonceSuffix]  = useState('')
  const [photos, setPhotos]                = useState<string[]>(initialProperty.gallery)
  const [plans, setPlans]                  = useState<string[]>([])
  const [matterportUrl, setMatterportUrl]  = useState<string>(initialProperty.matterportUrl ?? '')
  const [videoAnalysisStarted, setVideoAnalysisStarted] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [chapters, setChapters] = useState<Chapter[]>(INITIAL_CHAPTERS)

  const [copro, setCopro] = useState({
    isCopro: true,
    typeImmeuble: 'Haussmannien',
    anneeConstruction: initialProperty.yearBuilt ?? 1880,
    nbLots: initialProperty.lotCount ?? 10,
    chargesCopro: initialProperty.monthlyCharges ?? 720,
    proceduresEnCours: initialProperty.proceduresEnCours ?? false,
  })

  const [finance, setFinance] = useState({
    prixFAI: initialProperty.price,
    fraisCharges: 'acquereur' as 'acquereur' | 'vendeur',
    fraisAgenceTTC: 175_000,
    taxeFonciere: initialProperty.propertyTax ?? 5_400,
  })

  const [energy, setEnergy] = useState({
    ademeNumber: '',
    typeChauffage: '',
    sousType: '',
    typeVitrage: '',
    typeEauChaude: '',
    climatisation: false,
    vmc: false,
    consoValue: '',
    consoLabel: (initialProperty.dpe as DpeRating | undefined) ?? ('' as DpeRating | ''),
    gesValue: '',
    gesLabel: (initialProperty.ges as DpeRating | undefined) ?? ('' as DpeRating | ''),
    date: '',
    depenseMin: '',
    depenseMax: '',
  })

  const update = (patch: Partial<Property>) => setForm((p) => ({ ...p, ...patch }))
  const toggleSection = (k: SectionKey) => setOpenSection((cur) => (cur === k ? null : k))

  // ── Features ────────────────────────────────────────────────────────────
  const toggleFeature = (feat: string) => {
    const set = new Set(form.features ?? [])
    if (set.has(feat)) {
      set.delete(feat)
      const { [feat]: _removed, ...rest } = featureCounts
      void _removed
      setFeatureCounts(rest)
    } else {
      set.add(feat)
      if (COUNTABLE_TYPES.includes(feat)) setFeatureCounts((c) => ({ ...c, [feat]: c[feat] ?? 1 }))
    }
    update({ features: Array.from(set) })
  }
  const removeFeature = (feat: string) => toggleFeature(feat)
  const setFeatureCount = (feat: string, n: number) =>
    setFeatureCounts((c) => ({ ...c, [feat]: Math.max(1, n) }))

  // ── Tags (Spécificités) ─────────────────────────────────────────────────
  const addTag = () => {
    const t = tagDraft.trim()
    if (!t || form.tags.includes(t)) { setTagDraft(''); return }
    update({ tags: [...form.tags, t] })
    setTagDraft('')
  }
  const removeTag = (t: string) => update({ tags: form.tags.filter((x) => x !== t) })

  // ── Composition ─────────────────────────────────────────────────────────
  const updateCompositionRow = (i: number, patch: Partial<{ label: string; surface: number }>) => {
    const arr = [...(form.composition ?? [])]
    arr[i] = { ...arr[i], ...patch }
    update({ composition: arr })
  }
  const removeCompositionRow = (i: number) =>
    update({ composition: (form.composition ?? []).filter((_, idx) => idx !== i) })
  const addCompositionRow = () =>
    update({ composition: [...(form.composition ?? []), { label: '', surface: 0 }] })

  // ── Computed: annex composition entries ─────────────────────────────────
  const annexEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string }> = []
    for (const ann of ANNEX_TYPES) {
      if (!form.features?.includes(ann)) continue
      const count = featureCounts[ann] ?? 1
      for (let i = 0; i < count; i++) {
        entries.push({
          key: `${ann}-${i}`,
          label: count > 1 ? `${ann} ${i + 1}` : ann,
        })
      }
    }
    return entries
  }, [form.features, featureCounts])

  // ── Completion % (heuristic) ────────────────────────────────────────────
  const completion = useMemo(() => {
    const checks = [
      !!form.location?.trim(),
      !!quartier,
      !!form.title?.trim(),
      form.surface > 0,
      form.rooms > 0,
      finance.prixFAI > 0,
      !!form.description?.trim(),
      (form.composition?.length ?? 0) > 0,
      !!form.videoUrl,
      photos.length > 0,
      !!energy.consoLabel,
      !!energy.gesLabel,
    ]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [form, quartier, finance.prixFAI, photos.length, energy.consoLabel, energy.gesLabel])

  // ── Summaries ──────────────────────────────────────────────────────────
  const priceFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(finance.prixFAI)
  const sumGeneral    = `${form.rooms} pièces · ${form.surface}m² · ${quartier}`
  const sumFeatures   = (form.features?.length ?? 0) > 0 ? `${form.features!.length} caractéristique${form.features!.length > 1 ? 's' : ''}` : 'Aucune'
  const sumSpecs      = `${form.tags.length} spécificité${form.tags.length > 1 ? 's' : ''}`
  const sumComposition = `${form.composition?.length ?? 0} pièces · ${annexEntries.length} annexe${annexEntries.length > 1 ? 's' : ''}`
  const sumCopro      = copro.isCopro ? `${copro.typeImmeuble} · ${copro.anneeConstruction}` : 'Non en copropriété'
  const sumEnergy     = `DPE ${energy.consoLabel || '—'} · GES ${energy.gesLabel || '—'}`
  const sumFinance    = priceFmt
  const sumAnnonce    = `${form.description.length} caractères`
  const sumMedias     = `${form.videoUrl ? '1 vidéo · ' : 'Pas de vidéo · '}${photos.length} photo${photos.length > 1 ? 's' : ''}`
  const sumMandat     = `${MANDAT_OPTIONS.find((o) => o.value === form.mandatType)?.label ?? '—'}${form.avantPremiere ? ' · Avant-première' : ''}`

  const handleVideoUploaded = (url: string) => {
    update({ videoUrl: url })
    setVideoAnalysisStarted(true)
    setOpenSection('medias')
  }

  const removeVideo = () => {
    update({ videoUrl: undefined })
    setVideoAnalysisStarted(false)
    setVideoDuration(0)
  }

  const addChapter = () => {
    if (videoDuration <= 0) return
    // Place the new marker at the centre of the largest section between
    // existing markers (with 0 and videoDuration as virtual boundaries).
    const boundaries = [0, ...chapters.map((c) => c.startSec), videoDuration].sort((a, b) => a - b)
    let bestStart = videoDuration / 2
    let bestSize = -1
    for (let i = 0; i < boundaries.length - 1; i++) {
      const size = boundaries[i + 1] - boundaries[i]
      if (size > bestSize) {
        bestSize = size
        bestStart = (boundaries[i] + boundaries[i + 1]) / 2
      }
    }
    const startSec = Math.max(0, Math.min(videoDuration, bestStart))
    setChapters((prev) => [
      ...prev,
      { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: 'Nouveau', startSec },
    ])
  }

  return (
    <div>
      {/* ── Sticky header + progress bar ─────────────────────────────── */}
      <div
        className="sticky top-0 z-30"
        style={{ backgroundColor: '#F7F5F2', paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <header className="flex items-center gap-2 px-3 py-3">
          <button
            type="button"
            onClick={() => router.push('/agent/dashboard')}
            aria-label="Retour"
            className="w-9 h-9 rounded-full flex items-center justify-center active:bg-black/5"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-[16px] font-semibold flex-1 text-[#0a0a0a]">Modifier le bien</h1>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#0a0a0a]/20 text-[#0a0a0a] text-[12px] font-medium active:bg-black/5"
          >
            <Eye size={15} />
            Prévisualiser
          </button>
        </header>

        {/* Progress bar */}
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
            <span>Complétion</span>
            <span className="font-semibold text-[#0a0a0a]">{completion}%</span>
          </div>
          <div className="h-1 bg-gray-200/70 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all',
                completion >= 90 ? 'bg-emerald-500' : completion >= 60 ? 'bg-amber-500' : 'bg-red-400',
              )}
              style={{ width: `${completion}%` }}
            />
          </div>
        </div>
        <div className="border-b border-gray-200" />
      </div>

      <main className="px-4 pt-4 pb-32 flex flex-col gap-3">

        {/* ── Top video CTA (if no video) ────────────────────────────── */}
        {!form.videoUrl && (
          <div className="mb-1">
            <div className="flex items-center gap-2 mb-2 text-[#0a0a0a]">
              <Video size={15} />
              <p className="text-[12px] font-semibold">Ajoutez la vidéo du bien — indispensable pour publier.</p>
            </div>
            <MediaUploader
              bienId={form.id}
              type="video"
              onSuccess={handleVideoUploaded}
            />
          </div>
        )}

        {/* ─── 1. Général ─────────────────────────────────────────────── */}
        <Section
          title="Général"
          summary={sumGeneral}
          open={openSection === 'general'}
          onToggle={() => toggleSection('general')}
        >
          <Field label="Adresse" icon={<MapPin size={11} className="text-gray-400" />}>
            <TextInput
              value={form.location}
              onChange={(v) => update({ location: v })}
              placeholder="Saisissez une adresse…"
            />
            <p className="text-[10px] text-gray-400 mt-1">Adresse validée via Google Maps.</p>
          </Field>
          <ToggleRow
            label="Afficher l'adresse dans l'annonce"
            value={displayAddress}
            onChange={setDisplayAddress}
          />
          <Field label="Quartier">
            <select
              value={quartier}
              onChange={(e) => setQuartier(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40"
            >
              {QUARTIER_OPTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
            <p className="text-[10px] text-gray-400 mt-1">Suggéré automatiquement d&apos;après l&apos;adresse.</p>
          </Field>
          <Field label="Type de bien">
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value as typeof propertyType)}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40"
            >
              <option value="appartement">Appartement</option>
              <option value="maison">Maison</option>
              <option value="loft">Loft</option>
              <option value="atelier">Atelier</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Surface (m²)">
              <NumberInput value={form.surface} onChange={(v) => update({ surface: v ?? 0 })} />
            </Field>
            <Field label="Pièces">
              <NumberInput value={form.rooms} onChange={(v) => update({ rooms: v ?? 0 })} />
            </Field>
            <Field label="Chambres">
              <NumberInput value={form.bedrooms} onChange={(v) => update({ bedrooms: v })} />
            </Field>
            <Field label="Étage">
              <NumberInput value={form.floor} onChange={(v) => update({ floor: v })} />
            </Field>
            <Field label="Sur étages">
              <NumberInput value={form.totalFloors} onChange={(v) => update({ totalFloors: v })} />
            </Field>
          </div>
        </Section>

        {/* ─── 2. Caractéristiques ────────────────────────────────────── */}
        <Section
          title="Caractéristiques"
          summary={sumFeatures}
          open={openSection === 'features'}
          onToggle={() => toggleSection('features')}
        >
          {(form.features?.length ?? 0) === 0 ? (
            <p className="text-[12px] text-gray-400">Aucune caractéristique.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {form.features!.map((feat) => {
                const countable = COUNTABLE_TYPES.includes(feat)
                return (
                  <div key={feat} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    <span className="flex-1 text-[14px] text-[#0a0a0a]">{feat}</span>
                    {countable && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setFeatureCount(feat, (featureCounts[feat] ?? 1) - 1)}
                          className="w-7 h-7 rounded-lg bg-white border border-gray-200 text-[#0a0a0a] flex items-center justify-center"
                        >−</button>
                        <span className="w-6 text-center text-[13px] font-semibold">{featureCounts[feat] ?? 1}</span>
                        <button
                          type="button"
                          onClick={() => setFeatureCount(feat, (featureCounts[feat] ?? 1) + 1)}
                          className="w-7 h-7 rounded-lg bg-white border border-gray-200 text-[#0a0a0a] flex items-center justify-center"
                        >+</button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFeature(feat)}
                      aria-label={`Supprimer ${feat}`}
                      className="w-7 h-7 rounded-full bg-white border border-gray-200 text-gray-500 flex items-center justify-center"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setFeaturePickerOpen(true)}
            className="mt-3 w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-[13px] font-medium text-gray-700 active:bg-gray-50"
          >
            + Ajouter une caractéristique
          </button>
        </Section>

        {/* ─── 3. Spécificités ────────────────────────────────────────── */}
        <Section
          title="Spécificités"
          summary={sumSpecs}
          open={openSection === 'specs'}
          onToggle={() => toggleSection('specs')}
        >
          <div className="flex flex-wrap gap-2 mb-3">
            {form.tags.map((tag) => {
              const isFromVideo = TAGS_FROM_VIDEO.has(tag)
              return (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-full bg-gray-100 text-[12px] text-[#0a0a0a]"
                >
                  {isFromVideo && <Sparkles size={11} className="text-violet-500" />}
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="w-5 h-5 rounded-full bg-white text-gray-500 flex items-center justify-center"
                    aria-label={`Supprimer ${tag}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              )
            })}
            {form.tags.length === 0 && <p className="text-[12px] text-gray-400">Aucune spécificité.</p>}
          </div>
          <p className="text-[10px] text-gray-400 mb-2 flex items-center gap-1">
            <Sparkles size={10} className="text-violet-500" />
            Repère les spécificités détectées par l&apos;analyse vidéo.
          </p>
          <div className="flex gap-2">
            <TextInput
              value={tagDraft}
              onChange={setTagDraft}
              placeholder="Ajouter une spécificité…"
              onEnter={addTag}
            />
            <button
              type="button"
              onClick={addTag}
              aria-label="Ajouter"
              className="w-11 h-11 rounded-xl bg-[#0a0a0a] text-white flex items-center justify-center active:bg-[#222] flex-shrink-0"
            >
              <Plus size={18} />
            </button>
          </div>
        </Section>

        {/* ─── 4. Composition ─────────────────────────────────────────── */}
        <Section
          title="Composition"
          summary={sumComposition}
          open={openSection === 'composition'}
          onToggle={() => toggleSection('composition')}
        >
          <div className="flex flex-col gap-2">
            {(form.composition ?? []).map((row, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => updateCompositionRow(i, { label: e.target.value })}
                  placeholder="Pièce"
                  className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:border-[#0a0a0a]/40"
                />
                <input
                  type="number"
                  value={Number.isFinite(row.surface) ? row.surface : ''}
                  onChange={(e) => updateCompositionRow(i, { surface: e.target.valueAsNumber || 0 })}
                  placeholder="m²"
                  className="w-20 bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:border-[#0a0a0a]/40"
                />
                <button
                  type="button"
                  onClick={() => removeCompositionRow(i)}
                  aria-label="Supprimer la pièce"
                  className="w-10 h-10 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCompositionRow}
            className="mt-3 w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-[13px] font-medium text-gray-600 active:bg-gray-50"
          >
            + Ajouter une pièce
          </button>

          {annexEntries.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-200">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">Annexes</p>
              <div className="flex flex-col gap-2">
                {annexEntries.map(({ key, label }) => (
                  <div key={key} className="flex gap-2">
                    <span className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-[#0a0a0a]">
                      {label}
                    </span>
                    <input
                      type="number"
                      value={annexSurfaces[key] ?? ''}
                      onChange={(e) => setAnnexSurfaces((s) => ({ ...s, [key]: e.target.valueAsNumber || 0 }))}
                      placeholder="m²"
                      className="w-20 bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:border-[#0a0a0a]/40"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ─── 5. Copropriété ─────────────────────────────────────────── */}
        <Section
          title="Copropriété"
          summary={sumCopro}
          open={openSection === 'copro'}
          onToggle={() => toggleSection('copro')}
        >
          <ToggleRow
            label="Bien en copropriété"
            value={copro.isCopro}
            onChange={(v) => setCopro((c) => ({ ...c, isCopro: v }))}
          />
          {copro.isCopro && (
            <>
              <Field label="Type d'immeuble">
                <TextInput
                  value={copro.typeImmeuble}
                  onChange={(v) => setCopro((c) => ({ ...c, typeImmeuble: v }))}
                  placeholder="ex. Haussmannien, Années 30…"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Année de construction">
                  <NumberInput
                    value={copro.anneeConstruction}
                    onChange={(v) => setCopro((c) => ({ ...c, anneeConstruction: v ?? 0 }))}
                  />
                </Field>
                <Field label="Nombre de lots">
                  <NumberInput
                    value={copro.nbLots}
                    onChange={(v) => setCopro((c) => ({ ...c, nbLots: v ?? 0 }))}
                  />
                </Field>
              </div>
              <Field label="Charges de copropriété">
                <SuffixedNumberInput
                  value={copro.chargesCopro}
                  onChange={(v) => setCopro((c) => ({ ...c, chargesCopro: v ?? 0 }))}
                  suffix="€ / mois"
                />
              </Field>
              <ToggleRow
                label="Procédures en cours"
                value={copro.proceduresEnCours}
                onChange={(v) => setCopro((c) => ({ ...c, proceduresEnCours: v }))}
              />
            </>
          )}
        </Section>

        {/* ─── 6. Énergie ─────────────────────────────────────────────── */}
        <Section
          title="Énergie"
          summary={sumEnergy}
          open={openSection === 'energy'}
          onToggle={() => toggleSection('energy')}
        >
          <Field
            label="Numéro ADEME du DPE"
            sources={[<Sparkles key="s" size={11} className="text-violet-500" />, <Cable key="c" size={11} className="text-violet-500" />]}
          >
            <TextInput
              value={energy.ademeNumber}
              onChange={(v) => setEnergy((e) => ({ ...e, ademeNumber: v }))}
              placeholder="ex. 2675E0556019L"
            />
            <p className="text-[10px] text-gray-400 mt-1">Récupération automatique depuis le registre ADEME.</p>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type de chauffage">
              <SimpleSelect
                value={energy.typeChauffage}
                onChange={(v) => setEnergy((e) => ({ ...e, typeChauffage: v }))}
                options={['', 'Individuel', 'Collectif']}
                placeholder="—"
              />
            </Field>
            <Field label="Sous-type de chauffage">
              <SimpleSelect
                value={energy.sousType}
                onChange={(v) => setEnergy((e) => ({ ...e, sousType: v }))}
                options={['', 'Gaz', 'Électricité', 'Fioul', 'Pompe à chaleur', 'Bois']}
                placeholder="—"
              />
            </Field>
            <Field label="Type de vitrage">
              <SimpleSelect
                value={energy.typeVitrage}
                onChange={(v) => setEnergy((e) => ({ ...e, typeVitrage: v }))}
                options={['', 'Simple', 'Double', 'Triple']}
                placeholder="—"
              />
            </Field>
            <Field label="Type d'eau chaude">
              <SimpleSelect
                value={energy.typeEauChaude}
                onChange={(v) => setEnergy((e) => ({ ...e, typeEauChaude: v }))}
                options={['', 'Individuel - Gaz', 'Individuel - Électrique', 'Collectif - Gaz', 'Collectif - Électrique']}
                placeholder="—"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ToggleRow
              label="Climatisation"
              value={energy.climatisation}
              onChange={(v) => setEnergy((e) => ({ ...e, climatisation: v }))}
            />
            <ToggleRow
              label="VMC"
              value={energy.vmc}
              onChange={(v) => setEnergy((e) => ({ ...e, vmc: v }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Consommation (valeur)">
              <SuffixedNumberInput
                value={energy.consoValue === '' ? undefined : Number(energy.consoValue)}
                onChange={(v) => setEnergy((e) => ({ ...e, consoValue: v?.toString() ?? '' }))}
                suffix="kWh/m²/an"
              />
            </Field>
            <Field label="DPE — Étiquette">
              <DpeLabelSelect
                value={energy.consoLabel}
                onChange={(v) => {
                  setEnergy((e) => ({ ...e, consoLabel: v }))
                  if (v) update({ dpe: v })
                }}
              />
            </Field>
            <Field label="GES (valeur)">
              <SuffixedNumberInput
                value={energy.gesValue === '' ? undefined : Number(energy.gesValue)}
                onChange={(v) => setEnergy((e) => ({ ...e, gesValue: v?.toString() ?? '' }))}
                suffix="kg CO²/m²/an"
              />
            </Field>
            <Field label="GES — Étiquette">
              <DpeLabelSelect
                value={energy.gesLabel}
                onChange={(v) => {
                  setEnergy((e) => ({ ...e, gesLabel: v }))
                  if (v) update({ ges: v })
                }}
              />
            </Field>
          </div>
          <Field label="Date du DPE">
            <TextInput
              value={energy.date}
              onChange={(v) => setEnergy((e) => ({ ...e, date: v }))}
              placeholder="JJ/MM/AAAA"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dépense annuelle min.">
              <SuffixedNumberInput
                value={energy.depenseMin === '' ? undefined : Number(energy.depenseMin)}
                onChange={(v) => setEnergy((e) => ({ ...e, depenseMin: v?.toString() ?? '' }))}
                suffix="€ / an"
              />
            </Field>
            <Field label="Dépense annuelle max.">
              <SuffixedNumberInput
                value={energy.depenseMax === '' ? undefined : Number(energy.depenseMax)}
                onChange={(v) => setEnergy((e) => ({ ...e, depenseMax: v?.toString() ?? '' }))}
                suffix="€ / an"
              />
            </Field>
          </div>
        </Section>

        {/* ─── 7. Finances ────────────────────────────────────────────── */}
        <Section
          title="Finances"
          summary={sumFinance}
          open={openSection === 'finance'}
          onToggle={() => toggleSection('finance')}
        >
          <Field label="Prix de vente FAI">
            <SuffixedNumberInput
              value={finance.prixFAI}
              onChange={(v) => {
                setFinance((f) => ({ ...f, prixFAI: v ?? 0 }))
                update({ price: v ?? 0 })
              }}
              suffix="€"
            />
          </Field>
          <Field label="Frais à la charge de">
            <SimpleSelect
              value={finance.fraisCharges}
              onChange={(v) => setFinance((f) => ({ ...f, fraisCharges: v as typeof finance.fraisCharges }))}
              options={['acquereur', 'vendeur']}
              labelFor={(v) => v === 'acquereur' ? 'Acquéreur' : 'Vendeur'}
            />
          </Field>
          <Field label="Frais d'agence TTC">
            <SuffixedNumberInput
              value={finance.fraisAgenceTTC}
              onChange={(v) => setFinance((f) => ({ ...f, fraisAgenceTTC: v ?? 0 }))}
              suffix="€"
            />
          </Field>
          <Field label="Taxe foncière">
            <SuffixedNumberInput
              value={finance.taxeFonciere}
              onChange={(v) => {
                setFinance((f) => ({ ...f, taxeFonciere: v ?? 0 }))
                update({ propertyTax: v })
              }}
              suffix="€ / an"
            />
          </Field>
          <ToggleRow
            label="Afficher le prix dans l'annonce"
            value={displayPrice}
            onChange={setDisplayPrice}
          />
        </Section>

        {/* ─── 8. Texte d'annonce ──────────────────────────────────── */}
        <Section
          title="Texte d'annonce"
          summary={sumAnnonce}
          open={openSection === 'annonce'}
          onToggle={() => toggleSection('annonce')}
        >
          <Field label="Préfixe">
            <textarea
              value={annoncePrefix}
              onChange={(e) => setAnnoncePrefix(e.target.value)}
              placeholder="Texte d'introduction (configurable dans les paramètres)…"
              rows={2}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40 placeholder-gray-400"
            />
          </Field>
          <Field label="Corps de l'annonce">
            <textarea
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              rows={7}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40 leading-relaxed"
            />
            <p className="text-[10px] text-gray-400 mt-1">Sélectionnez du texte pour activer la mise en forme (à venir).</p>
          </Field>
          <Field label="Suffixe">
            <textarea
              value={annonceSuffix}
              onChange={(e) => setAnnonceSuffix(e.target.value)}
              placeholder="Mentions légales, signature… (configurable)"
              rows={2}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40 placeholder-gray-400"
            />
          </Field>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#0a0a0a]/20 text-[12px] font-medium text-[#0a0a0a] active:bg-black/5"
          >
            <RefreshCw size={13} />
            Régénérer automatiquement
          </button>
        </Section>

        {/* ─── 9. Médias ──────────────────────────────────────────────── */}
        <Section
          title="Médias"
          summary={sumMedias}
          open={openSection === 'medias'}
          onToggle={() => toggleSection('medias')}
        >
          {/* Vidéo */}
          <SubSection
            title="Vidéo"
            rightSlot={
              form.videoUrl ? (
                <button
                  type="button"
                  onClick={removeVideo}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 text-[11px] font-medium text-red-600 active:bg-red-50"
                >
                  <Trash2 size={11} />
                  Supprimer la vidéo
                </button>
              ) : null
            }
          >
            {form.videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={form.videoUrl}
                  preload="metadata"
                  controls
                  playsInline
                  onLoadedMetadata={() => {
                    if (videoRef.current) setVideoDuration(videoRef.current.duration || 0)
                  }}
                  className="w-full rounded-xl bg-black"
                  style={{ aspectRatio: '9 / 16' }}
                />

                {videoAnalysisStarted && (
                  <div className="mt-4">
                    <VideoChapterEditor
                      videoRef={videoRef}
                      duration={videoDuration}
                      chapters={chapters}
                      onChange={setChapters}
                    />

                    <p className="text-[11px] text-gray-400 text-center mt-2 leading-snug">
                      Les temps forts aident les acquéreurs à se repérer dans votre vidéo. Déplacez-les, renommez-les, ajoutez-en ou supprimez-en selon vos besoins.
                    </p>

                    <div className="flex justify-center mt-3">
                      <button
                        type="button"
                        onClick={addChapter}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] font-medium text-[#0a0a0a] active:bg-gray-50"
                      >
                        <Plus size={13} />
                        Ajouter un temps fort
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <MediaUploader
                bienId={form.id}
                type="video"
                onSuccess={handleVideoUploaded}
              />
            )}

            {/* ── Analyse IA CTA (before analysis is started) ──────────── */}
            {form.videoUrl && !videoAnalysisStarted && (
              <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-6 flex flex-col items-center text-center">
                <h4 className="text-[14px] font-semibold text-[#0a0a0a]">Analyser la vidéo</h4>
                <p className="text-[12px] text-gray-500 mt-1 max-w-[280px] leading-snug">
                  Extrait automatiquement les spécificités du bien et marque les temps forts
                </p>
                <button
                  type="button"
                  onClick={() => setVideoAnalysisStarted(true)}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0a0a0a] text-white text-[13px] font-semibold active:bg-[#222]"
                >
                  <Sparkles size={13} className="text-violet-300" />
                  Analyse IA
                </button>
              </div>
            )}

            {/* ── Results (after analysis is started) ──────────────────── */}
            {form.videoUrl && videoAnalysisStarted && (
              <>
                <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2.5 flex items-center gap-1">
                    <Sparkles size={11} className="text-violet-500" />
                    Spécificités extraites
                  </p>
                  {(() => {
                    const extracted = form.tags.filter((t) => TAGS_FROM_VIDEO.has(t))
                    if (extracted.length === 0) {
                      return <p className="text-[12px] text-gray-400">Aucune spécificité détectée pour l&apos;instant</p>
                    }
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {extracted.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-white border border-gray-200 text-[11px] text-[#0a0a0a]"
                          >
                            {t}
                            <button
                              type="button"
                              onClick={() => removeTag(t)}
                              aria-label={`Supprimer ${t}`}
                              className="w-4 h-4 rounded-full bg-white text-gray-500 flex items-center justify-center active:bg-gray-100"
                            >
                              <X size={9} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )
                  })()}
                </div>

              </>
            )}
          </SubSection>

          {/* Photos */}
          <SubSection title="Photos">
            {photos.length === 0 ? (
              <MediaUploader
                bienId={form.id}
                type="photo"
                multiple
                onSuccess={(url) => setPhotos((p) => [...p, url])}
              />
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                      aria-label="Supprimer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {photos.length < 25 && (
                  <MediaUploader
                    bienId={form.id}
                    type="photo"
                    multiple
                    variant="tile"
                    onSuccess={(url) => setPhotos((p) => [...p, url])}
                  />
                )}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-2">{photos.length} / 25 photos · réorganisation à venir.</p>
          </SubSection>

          {/* Plan */}
          <SubSection title="Plan">
            {plans.length > 0 && (
              <div className="flex flex-col gap-2 mb-3">
                {plans.map((url, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-3">
                    <ImageIcon size={18} className="text-gray-500" />
                    <span className="flex-1 text-[13px] truncate">{url.split('/').pop()}</span>
                    <button
                      type="button"
                      onClick={() => setPlans((p) => p.filter((_, idx) => idx !== i))}
                      className="w-7 h-7 rounded-full bg-white border border-gray-200 text-gray-500 flex items-center justify-center"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <MediaUploader
              bienId={form.id}
              type="plan"
              onSuccess={(url) => setPlans((p) => [...p, url])}
            />
          </SubSection>

          {/* Visite virtuelle */}
          <SubSection title="Visite virtuelle">
            {matterportUrl && (
              <div className="mb-3 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-3">
                <Globe size={14} className="text-gray-500 flex-shrink-0" />
                <span className="flex-1 text-[12px] text-[#0a0a0a] truncate">{matterportUrl}</span>
                <button
                  type="button"
                  onClick={() => {
                    setMatterportUrl('')
                    update({ matterportUrl: undefined })
                  }}
                  className="w-7 h-7 rounded-full bg-white border border-gray-200 text-gray-500 flex items-center justify-center"
                  aria-label="Retirer"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <MediaUploader
              bienId={form.id}
              type="visite_virtuelle"
              onSuccess={(url) => {
                setMatterportUrl(url)
                update({ matterportUrl: url })
              }}
            />
          </SubSection>
        </Section>

        {/* ─── 10. Mandat ─────────────────────────────────────────────── */}
        <Section
          title="Mandat"
          summary={sumMandat}
          open={openSection === 'mandat'}
          onToggle={() => toggleSection('mandat')}
        >
          <Field label="Type de mandat">
            <SimpleSelect
              value={form.mandatType === 'COEXCLUSIF' ? 'EXCLUSIF' : (form.mandatType ?? 'SIMPLE')}
              onChange={(v) => update({ mandatType: v as MandatType })}
              options={MANDAT_OPTIONS.map((o) => o.value)}
              labelFor={(v) => MANDAT_OPTIONS.find((o) => o.value === v)?.label ?? v}
            />
          </Field>
          <ToggleRow
            label="Avant-première (en exclu sur Shomee)"
            value={!!form.avantPremiere}
            onChange={(v) => update({ avantPremiere: v })}
          />
          <Field label="Référence interne">
            <TextInput
              value={form.refInterneAgence ?? ''}
              onChange={(v) => update({ refInterneAgence: v || undefined })}
              placeholder="ex. KRZ-8-FSH-0211"
            />
          </Field>
        </Section>
      </main>

      {/* ── Save / publish bar (no AgentBottomNav on editor) ───────────── */}
      <div
        className="fixed left-0 right-0 z-40 bg-white border-t border-gray-200 px-4 py-3 flex gap-3"
        style={{ bottom: 0, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      >
        <button
          type="button"
          className="flex-1 py-3 rounded-xl border border-[#0a0a0a] text-[#0a0a0a] font-semibold text-[14px] active:bg-[#0a0a0a]/[0.03]"
        >
          Sauvegarder
        </button>
        <button
          type="button"
          className="flex-1 py-3 rounded-xl bg-[#0a0a0a] text-white font-semibold text-[14px] active:bg-[#222]"
        >
          Publier
        </button>
      </div>

      {/* ── Feature picker dialog ──────────────────────────────────── */}
      <AnimatePresence>
        {featurePickerOpen && (
          <>
            <motion.div
              key="picker-bd"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFeaturePickerOpen(false)}
              className="fixed inset-0 z-[180] bg-black/50"
            />
            <motion.div
              key="picker"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              className="fixed left-0 right-0 bottom-0 z-[190] bg-white rounded-t-2xl px-4 pt-4"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
            >
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <h3 className="text-[16px] font-semibold mb-3">Ajouter une caractéristique</h3>
              <div className="flex flex-wrap gap-2 mb-2">
                {ALL_FEATURES.filter((f) => !form.features?.includes(f)).map((feat) => (
                  <button
                    key={feat}
                    type="button"
                    onClick={() => { toggleFeature(feat); setFeaturePickerOpen(false) }}
                    className="px-3 py-1.5 rounded-full text-[12px] font-medium bg-gray-100 text-[#0a0a0a] active:bg-gray-200"
                  >
                    {feat}
                  </button>
                ))}
              </div>
              {ALL_FEATURES.filter((f) => !form.features?.includes(f)).length === 0 && (
                <p className="text-[12px] text-gray-400">Toutes les caractéristiques sont déjà ajoutées.</p>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Preview modal ─────────────────────────────────────────── */}
      <div
        className={clsx(
          'fixed inset-0 z-[200] bg-black transition-opacity duration-200',
          previewOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      >
        <PropertyDetailSheet
          property={form}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          isFavorite={false}
          onToggleFavorite={() => {}}
        />
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Section({
  title, summary, open, onToggle, children,
}: {
  title: string; summary?: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left active:bg-gray-50"
      >
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-[#0a0a0a]">{title}</h2>
          {!open && summary && (
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">{summary}</p>
          )}
        </div>
        <ChevronDown
          size={18}
          className={clsx('text-gray-500 transition-transform flex-shrink-0', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 flex flex-col gap-3 border-t border-gray-100">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function SubSection({
  title, required, rightSlot, children,
}: {
  title: string
  required?: boolean
  rightSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="pt-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[#0a0a0a] flex items-center gap-2">
          {title}
          {required && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600">Obligatoire</span>}
        </h4>
        {rightSlot}
      </div>
      {children}
    </div>
  )
}

function Field({
  label, icon, sources, children,
}: {
  label: string
  icon?: React.ReactNode
  sources?: React.ReactNode[]
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
        <span>{label}</span>
        {icon}
        {sources && sources.length > 0 && (
          <span className="inline-flex items-center gap-1">{sources}</span>
        )}
      </label>
      {children}
    </div>
  )
}

function TextInput({
  value, onChange, placeholder, onEnter,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; onEnter?: () => void
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() }
      }}
      placeholder={placeholder}
      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] placeholder-gray-400 focus:outline-none focus:border-[#0a0a0a]/40"
    />
  )
}

function NumberInput({
  value, onChange, placeholder,
}: {
  value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.valueAsNumber
        onChange(Number.isFinite(v) ? v : undefined)
      }}
      placeholder={placeholder}
      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40"
    />
  )
}

function SuffixedNumberInput({
  value, onChange, suffix,
}: {
  value: number | undefined; onChange: (v: number | undefined) => void; suffix: string
}) {
  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 focus-within:border-[#0a0a0a]/40">
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.valueAsNumber
          onChange(Number.isFinite(v) ? v : undefined)
        }}
        className="flex-1 bg-transparent text-[14px] text-[#0a0a0a] focus:outline-none"
      />
      <span className="text-[12px] text-gray-500 whitespace-nowrap">{suffix}</span>
    </div>
  )
}

function SimpleSelect<T extends string>({
  value, onChange, options, placeholder, labelFor,
}: {
  value: T | ''
  onChange: (v: T) => void
  options: ReadonlyArray<T | ''>
  placeholder?: string
  labelFor?: (v: T | '') => string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt === '' ? (placeholder ?? '—') : (labelFor?.(opt) ?? opt)}</option>
      ))}
    </select>
  )
}

function DpeLabelSelect({
  value, onChange,
}: {
  value: DpeRating | ''
  onChange: (v: DpeRating | '') => void
}) {
  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl pl-2 pr-3 py-2 focus-within:border-[#0a0a0a]/40">
      {value && (
        <span
          className="inline-block px-2 py-0.5 rounded text-white font-bold text-[12px]"
          style={{ backgroundColor: DPE_COLORS[value] }}
        >
          {value}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange((e.target.value || '') as DpeRating | '')}
        className="flex-1 bg-transparent text-[14px] text-[#0a0a0a] focus:outline-none"
      >
        <option value="">—</option>
        {DPE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  )
}

function ToggleRow({
  label, value, onChange,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
      <span className="text-[13px] text-[#0a0a0a]">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        className={clsx(
          'relative inline-flex items-center w-11 h-6 rounded-full transition-colors flex-shrink-0',
          value ? 'bg-[#0a0a0a]' : 'bg-gray-300',
        )}
      >
        <span
          className={clsx(
            'inline-block w-4 h-4 rounded-full bg-white shadow transition-transform duration-150',
            value ? 'translate-x-[24px]' : 'translate-x-[4px]',
          )}
        />
      </button>
    </div>
  )
}
