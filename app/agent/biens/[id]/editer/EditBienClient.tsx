'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, Eye, ChevronDown, Plus, X, RefreshCw, Trash2, Video, FileText, Upload,
} from 'lucide-react'
import clsx from 'clsx'
import type { Property, DpeRating, MandatType } from '@/lib/types'
import PropertyDetailSheet from '@/components/PropertyDetailSheet'

const FEATURE_OPTIONS = [
  'Ascenseur', 'Cave', 'Parking', 'Balcon', 'Terrasse',
  'Gardien', 'Parquet', 'Cheminée', 'Double vitrage', 'Digicode',
]
const DPE_OPTIONS: DpeRating[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const ORIENTATIONS: Array<{ key: 'N' | 'S' | 'E' | 'O'; label: string; full: string }> = [
  { key: 'N', label: 'N', full: 'Nord' },
  { key: 'S', label: 'S', full: 'Sud' },
  { key: 'E', label: 'E', full: 'Est' },
  { key: 'O', label: 'O', full: 'Ouest' },
]
const MANDAT_OPTIONS: Array<{ value: MandatType; label: string }> = [
  { value: 'EXCLUSIF',   label: 'Exclusif' },
  { value: 'COEXCLUSIF', label: 'Co-exclusif' },
  { value: 'SIMPLE',     label: 'Simple' },
]

type SectionKey =
  | 'infos' | 'features' | 'ambiance' | 'tags' | 'description'
  | 'composition' | 'diagnostics' | 'video' | 'documents' | 'commerce'

function parseOrientation(s: string | undefined): Set<'N' | 'S' | 'E' | 'O'> {
  const set = new Set<'N' | 'S' | 'E' | 'O'>()
  if (!s) return set
  const lc = s.toLowerCase()
  if (/nord/.test(lc)) set.add('N')
  if (/sud/.test(lc)) set.add('S')
  if (/(^|[\s-])est([\s-]|$)/.test(lc)) set.add('E')
  if (/ouest/.test(lc)) set.add('O')
  return set
}

function joinOrientation(set: Set<'N' | 'S' | 'E' | 'O'>): string | undefined {
  const order: Array<'N' | 'S' | 'E' | 'O'> = ['N', 'S', 'E', 'O']
  const labels: Record<'N' | 'S' | 'E' | 'O', string> = { N: 'Nord', S: 'Sud', E: 'Est', O: 'Ouest' }
  const parts = order.filter((k) => set.has(k)).map((k) => labels[k])
  return parts.length === 0 ? undefined : parts.join('-')
}

export default function EditBienClient({ initialProperty }: { initialProperty: Property }) {
  const router = useRouter()
  const [form, setForm] = useState<Property>(initialProperty)
  const [openSection, setOpenSection] = useState<SectionKey | null>('infos')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [propertyType, setPropertyType] = useState('appartement')
  const [orientationSet, setOrientationSet] = useState(() => parseOrientation(form.orientation))
  const [documents, setDocuments] = useState<Array<{ id: string; name: string }>>([
    { id: 'd1', name: 'Plan.pdf' },
    { id: 'd2', name: 'PV_AG_2024.pdf' },
  ])

  const update = (patch: Partial<Property>) => setForm((p) => ({ ...p, ...patch }))

  const toggleSection = (key: SectionKey) =>
    setOpenSection((cur) => (cur === key ? null : key))

  // ── Feature pills ────────────────────────────────────────────────────────
  const toggleFeature = (feat: string) => {
    const set = new Set(form.features ?? [])
    if (set.has(feat)) set.delete(feat)
    else set.add(feat)
    update({ features: Array.from(set) })
  }

  // ── Orientation pills ────────────────────────────────────────────────────
  const toggleOrientation = (k: 'N' | 'S' | 'E' | 'O') => {
    const next = new Set(orientationSet)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setOrientationSet(next)
    update({ orientation: joinOrientation(next) })
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  const addTag = () => {
    const t = tagDraft.trim()
    if (!t || form.tags.includes(t)) {
      setTagDraft('')
      return
    }
    update({ tags: [...form.tags, t] })
    setTagDraft('')
  }
  const removeTag = (t: string) => update({ tags: form.tags.filter((x) => x !== t) })

  // ── Composition ──────────────────────────────────────────────────────────
  const updateCompositionRow = (i: number, patch: Partial<{ label: string; surface: number }>) => {
    const arr = [...(form.composition ?? [])]
    arr[i] = { ...arr[i], ...patch }
    update({ composition: arr })
  }
  const removeCompositionRow = (i: number) =>
    update({ composition: (form.composition ?? []).filter((_, idx) => idx !== i) })
  const addCompositionRow = () =>
    update({ composition: [...(form.composition ?? []), { label: '', surface: 0 }] })

  // ── Summary helpers ──────────────────────────────────────────────────────
  const priceFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(form.price)
  const infosSummary = `${form.rooms} pièces · ${form.surface}m² · ${priceFmt}`
  const featuresSummary = (form.features?.length ?? 0) > 0 ? form.features!.join(', ') : 'Aucune'
  const tagsSummary = `${form.tags.length} caractéristique${form.tags.length > 1 ? 's' : ''}`
  const compositionSummary = `${form.composition?.length ?? 0} pièce${(form.composition?.length ?? 0) > 1 ? 's' : ''}`
  const diagSummary = `DPE ${form.dpe}${form.ges ? ' · GES ' + form.ges : ''}`
  const videoSummary = form.videoUrl ? form.videoUrl.split('/').pop() ?? 'Vidéo présente' : 'Aucune vidéo'
  const docsSummary = `${documents.length} document${documents.length > 1 ? 's' : ''}`
  const mandatLabel = MANDAT_OPTIONS.find((o) => o.value === form.mandatType)?.label ?? '—'
  const commerceSummary = `${mandatLabel}${form.avantPremiere ? ' · Avant-première' : ''}`

  return (
    <div>
      {/* ── Sticky header ──────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-3 py-3 border-b border-gray-200"
        style={{ backgroundColor: '#F7F5F2', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
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
          aria-label="Prévisualiser"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#0a0a0a]/20 text-[#0a0a0a] text-[12px] font-medium active:bg-black/5"
        >
          <Eye size={15} />
          Prévisualiser
        </button>
      </header>

      {/* ── Sections ──────────────────────────────────────────────────── */}
      <main className="px-4 pt-4 pb-32 flex flex-col gap-3">

        {/* ── 1. Informations essentielles ── */}
        <Section
          title="Informations essentielles"
          summary={infosSummary}
          open={openSection === 'infos'}
          onToggle={() => toggleSection('infos')}
        >
          <Field label="Adresse">
            <TextInput value={form.location} onChange={(v) => update({ location: v })} />
          </Field>
          <Field label="Arrondissement">
            <TextInput value={form.arrondissement} onChange={(v) => update({ arrondissement: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prix (€)">
              <NumberInput value={form.price} onChange={(v) => update({ price: v ?? 0 })} />
            </Field>
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
          <Field label="Type de bien">
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40"
            >
              <option value="appartement">Appartement</option>
              <option value="maison">Maison</option>
              <option value="loft">Loft</option>
              <option value="atelier">Atelier</option>
            </select>
          </Field>
        </Section>

        {/* ── 2. Caractéristiques ── */}
        <Section
          title="Caractéristiques"
          summary={featuresSummary}
          open={openSection === 'features'}
          onToggle={() => toggleSection('features')}
        >
          <div className="flex flex-wrap gap-2">
            {FEATURE_OPTIONS.map((feat) => {
              const active = form.features?.includes(feat)
              return (
                <button
                  key={feat}
                  type="button"
                  onClick={() => toggleFeature(feat)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors',
                    active
                      ? 'bg-[#0a0a0a] text-white'
                      : 'bg-gray-100 text-[#0a0a0a] active:bg-gray-200',
                  )}
                >
                  {feat}
                </button>
              )
            })}
          </div>
        </Section>

        {/* ── 3. Ambiance & standing ── */}
        <Section
          title="Ambiance & standing"
          summary={form.orientation ?? 'Non renseigné'}
          open={openSection === 'ambiance'}
          onToggle={() => toggleSection('ambiance')}
        >
          <Field label="Orientation">
            <div className="flex gap-2">
              {ORIENTATIONS.map(({ key, label, full }) => {
                const active = orientationSet.has(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleOrientation(key)}
                    aria-label={full}
                    className={clsx(
                      'w-12 h-12 rounded-full text-[14px] font-bold transition-colors',
                      active
                        ? 'bg-[#0a0a0a] text-white'
                        : 'bg-gray-100 text-[#0a0a0a] active:bg-gray-200',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Extérieur">
            <TextInput value={form.exteriorType ?? ''} onChange={(v) => update({ exteriorType: v || undefined })} placeholder="ex. Balcon 8m²" />
          </Field>
          <Field label="Chauffage">
            <TextInput value={form.heatingType ?? ''} onChange={(v) => update({ heatingType: v || undefined })} />
          </Field>
          <Field label="Eau chaude">
            <TextInput value={form.hotWaterType ?? ''} onChange={(v) => update({ hotWaterType: v || undefined })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Année construction">
              <NumberInput value={form.yearBuilt} onChange={(v) => update({ yearBuilt: v })} />
            </Field>
            <Field label="Charges mensuelles (€)">
              <NumberInput value={form.monthlyCharges} onChange={(v) => update({ monthlyCharges: v })} />
            </Field>
          </div>
          <Field label="Taxe foncière (€)">
            <NumberInput value={form.propertyTax} onChange={(v) => update({ propertyTax: v })} />
          </Field>
        </Section>

        {/* ── 4. Critères fins (tags) ── */}
        <Section
          title="Critères fins"
          summary={tagsSummary}
          open={openSection === 'tags'}
          onToggle={() => toggleSection('tags')}
        >
          <div className="flex flex-wrap gap-2 mb-3">
            {form.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full bg-gray-100 text-[12px] text-[#0a0a0a]"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="w-5 h-5 rounded-full bg-white text-gray-500 flex items-center justify-center active:bg-gray-200"
                  aria-label={`Supprimer ${tag}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {form.tags.length === 0 && (
              <p className="text-[12px] text-gray-400">Aucune caractéristique.</p>
            )}
          </div>
          <div className="flex gap-2">
            <TextInput
              value={tagDraft}
              onChange={setTagDraft}
              placeholder="Ajouter une caractéristique…"
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

        {/* ── 5. Description ── */}
        <Section
          title="Description"
          summary={`${form.description.length} caractère${form.description.length > 1 ? 's' : ''}`}
          open={openSection === 'description'}
          onToggle={() => toggleSection('description')}
        >
          <textarea
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            rows={6}
            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] focus:outline-none focus:border-[#0a0a0a]/40 leading-relaxed"
          />
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#0a0a0a]/20 text-[12px] font-medium text-[#0a0a0a] active:bg-black/5"
          >
            <RefreshCw size={13} />
            Régénérer automatiquement
          </button>
        </Section>

        {/* ── 6. Composition ── */}
        <Section
          title="Composition"
          summary={compositionSummary}
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
                  className="w-10 h-10 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center active:bg-gray-200"
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
        </Section>

        {/* ── 7. Diagnostics ── */}
        <Section
          title="Diagnostics"
          summary={diagSummary}
          open={openSection === 'diagnostics'}
          onToggle={() => toggleSection('diagnostics')}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="DPE">
              <select
                value={form.dpe}
                onChange={(e) => update({ dpe: e.target.value as Property['dpe'] })}
                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] focus:outline-none focus:border-[#0a0a0a]/40"
              >
                {DPE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="GES">
              <select
                value={form.ges ?? ''}
                onChange={(e) => update({ ges: (e.target.value || undefined) as Property['ges'] })}
                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] focus:outline-none focus:border-[#0a0a0a]/40"
              >
                <option value="">—</option>
                {DPE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        {/* ── 8. Vidéo ── */}
        <Section
          title="Vidéo"
          summary={videoSummary}
          open={openSection === 'video'}
          onToggle={() => toggleSection('video')}
        >
          {form.videoUrl ? (
            <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-[#0a0a0a]/5 flex items-center justify-center flex-shrink-0">
                <Video size={18} className="text-[#0a0a0a]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[#0a0a0a] truncate">
                  {form.videoUrl.split('/').pop()}
                </p>
                <p className="text-[11px] text-gray-500">Vidéo actuelle</p>
              </div>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-[#0a0a0a]/20 text-[12px] font-medium active:bg-black/5"
              >
                Remplacer
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-gray-300 text-[13px] font-medium text-gray-700 active:bg-gray-50"
            >
              <Upload size={15} />
              Ajouter une vidéo
            </button>
          )}
        </Section>

        {/* ── 9. Documents ── */}
        <Section
          title="Documents"
          summary={docsSummary}
          open={openSection === 'documents'}
          onToggle={() => toggleSection('documents')}
        >
          <div className="flex flex-col gap-2 mb-3">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                <FileText size={18} className="text-gray-500 flex-shrink-0" />
                <span className="text-[13px] text-[#0a0a0a] flex-1 truncate">{doc.name}</span>
                <button
                  type="button"
                  onClick={() => setDocuments((prev) => prev.filter((d) => d.id !== doc.id))}
                  aria-label="Supprimer"
                  className="w-7 h-7 rounded-full bg-white border border-gray-200 text-gray-500 flex items-center justify-center active:bg-gray-100"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {documents.length === 0 && (
              <p className="text-[12px] text-gray-400">Aucun document.</p>
            )}
          </div>
          <button
            type="button"
            className="w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-[13px] font-medium text-gray-600 active:bg-gray-50"
          >
            + Ajouter un document
          </button>
        </Section>

        {/* ── 10. Paramètres commerciaux ── */}
        <Section
          title="Paramètres commerciaux"
          summary={commerceSummary}
          open={openSection === 'commerce'}
          onToggle={() => toggleSection('commerce')}
        >
          <Field label="Type de mandat">
            <div className="flex flex-col gap-2">
              {MANDAT_OPTIONS.map(({ value, label }) => {
                const active = form.mandatType === value
                return (
                  <label
                    key={value}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors',
                      active ? 'border-[#0a0a0a] bg-[#0a0a0a]/[0.03]' : 'border-gray-200 active:bg-gray-50',
                    )}
                  >
                    <span
                      className={clsx(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                        active ? 'border-[#0a0a0a]' : 'border-gray-300',
                      )}
                    >
                      {active && <span className="w-2 h-2 rounded-full bg-[#0a0a0a]" />}
                    </span>
                    <span className="text-[14px] text-[#0a0a0a]">{label}</span>
                    <input
                      type="radio"
                      name="mandat"
                      value={value}
                      checked={active}
                      onChange={() => update({ mandatType: value })}
                      className="sr-only"
                    />
                  </label>
                )
              })}
            </div>
          </Field>
          <Field label="Avant-première">
            <button
              type="button"
              onClick={() => update({ avantPremiere: !form.avantPremiere })}
              role="switch"
              aria-checked={!!form.avantPremiere}
              className={clsx(
                'relative w-12 h-7 rounded-full transition-colors',
                form.avantPremiere ? 'bg-[#0a0a0a]' : 'bg-gray-200',
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 w-5 h-5 rounded-full bg-white transition-transform',
                  form.avantPremiere ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </Field>
          <Field label="Référence interne">
            <TextInput
              value={form.refInterneAgence ?? ''}
              onChange={(v) => update({ refInterneAgence: v || undefined })}
              placeholder="ex. KRZ-8-FSH-0211"
            />
          </Field>
        </Section>
      </main>

      {/* ── Sticky save / publish bar (above AgentBottomNav) ────────────── */}
      <div
        className="fixed left-0 right-0 z-40 bg-white border-t border-gray-200 px-4 py-3 flex gap-3"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
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

      {/* ── Preview modal — full-screen with PropertyDetailSheet inside ── */}
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
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string
  summary?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onEnter?: () => void
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault()
          onEnter()
        }
      }}
      placeholder={placeholder}
      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-[#0a0a0a] placeholder-gray-400 focus:outline-none focus:border-[#0a0a0a]/40"
    />
  )
}

function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
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
