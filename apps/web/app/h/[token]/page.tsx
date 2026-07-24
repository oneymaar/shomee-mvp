/**
 * /h/<token> — landing du handoff LLM → app native (S9, squelette H1).
 *
 * Server component : lit le Handoff directement en base (pas d'API), rend
 * un récap minimal du brief + le code court + les CTA (ouvrir / télécharger).
 * H2 remplacera le récap minimal par la réplique de l'écran de fin
 * d'onboarding (jauge « N biens », cartes floutées, édition, connexion).
 *
 * C'est aussi cette route que les Universal Links couvriront (H0, domaine) :
 * app installée → iOS ouvre l'app à la place de cette page.
 */

import type { CSSProperties } from 'react'
import { prisma } from '@/lib/prisma'
import { formatShortCode } from '@/lib/handoff/shortCode'
import HandoffActions from './HandoffActions'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Votre recherche — SHOMEE',
  description: 'Votre brief est prêt. Ouvrez SHOMEE pour découvrir les biens qui vous correspondent.',
}

// ─── Lecture défensive du brief (Json) ──────────────────────────────────────

interface BriefView {
  locationQuery?: string
  propertyTypes?: string[]
  minRooms?: number | null
  minSurface?: number | null
  maxSurface?: number | null
  budgetMin?: number | null
  budgetMax?: number | null
  chipStates?: Record<string, number>
  customCriteria?: { label?: string; state?: number }[]
  transcriptSummary?: string
}

const euros = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const frDate = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(d)

/** Critères par état (1 souhaité / 2 obligatoire / 3 rédhibitoire), chips + customs confondus. */
function criteriaByState(brief: BriefView): { label: string; state: number }[] {
  const out: { label: string; state: number }[] = []
  for (const [label, state] of Object.entries(brief.chipStates ?? {})) {
    if (state === 1 || state === 2 || state === 3) out.push({ label, state })
  }
  for (const c of brief.customCriteria ?? []) {
    if (typeof c?.label === 'string' && c.label) out.push({ label: c.label, state: c.state ?? 1 })
  }
  // Obligatoires d'abord, puis souhaités, puis rédhibitoires.
  const order = { 2: 0, 1: 1, 3: 2 } as Record<number, number>
  return out.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9))
}

// ─── Styles (autonomes — aucun système de design requis pour le squelette) ──

const S: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#0e1015', color: '#e9ebf0',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    display: 'flex', justifyContent: 'center', padding: '40px 20px 60px',
  },
  card: { width: '100%', maxWidth: 480 },
  brand: { fontSize: 13, letterSpacing: 3, color: '#98a0ae', textTransform: 'uppercase' as const },
  h1: { fontSize: 24, fontWeight: 700, margin: '10px 0 6px' },
  sub: { color: '#98a0ae', fontSize: 14, marginBottom: 24 },
  section: { background: '#181b22', border: '1px solid #2a2f3a', borderRadius: 14, padding: '16px 18px', marginBottom: 14 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #232833', fontSize: 14 },
  rowLast: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', fontSize: 14 },
  key: { color: '#98a0ae' },
  val: { fontWeight: 600, textAlign: 'right' as const },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginTop: 10 },
  chip: { fontSize: 12.5, padding: '5px 11px', borderRadius: 999, border: '1px solid #2f3542', color: '#c6ccd6' },
  chipMust: { borderColor: 'rgba(74,222,128,.45)', color: '#7ce0a4' },
  chipNo: { borderColor: 'rgba(240,113,103,.45)', color: '#f0938b', textDecoration: 'line-through' },
  legend: { fontSize: 11.5, color: '#7d8592', marginTop: 10 },
  expiry: { fontSize: 12, color: '#7d8592', textAlign: 'center' as const, marginTop: 18 },
  state: { textAlign: 'center' as const, padding: '60px 0' },
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function HandoffLandingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const handoff = await prisma.handoff.findUnique({ where: { token } })

  if (!handoff) {
    return (
      <main style={S.page}>
        <div style={{ ...S.card, ...S.state }}>
          <div style={S.brand}>Shomee</div>
          <h1 style={S.h1}>Lien introuvable</h1>
          <p style={S.sub}>Ce lien ne correspond à aucun brief. Reprenez la conversation avec votre assistant pour en générer un nouveau.</p>
        </div>
      </main>
    )
  }

  const expired = handoff.expiresAt.getTime() < Date.now()
  if (expired) {
    return (
      <main style={S.page}>
        <div style={{ ...S.card, ...S.state }}>
          <div style={S.brand}>Shomee</div>
          <h1 style={S.h1}>Ce lien a expiré</h1>
          <p style={S.sub}>Un brief reste valable 7 jours. Refaites votre brief avec votre assistant — deux minutes suffisent.</p>
        </div>
      </main>
    )
  }

  const brief = (handoff.brief ?? {}) as BriefView
  const criteria = criteriaByState(brief)
  const claimed = handoff.status === 'claimed'
  const code = formatShortCode(handoff.shortCode)

  return (
    <main style={S.page}>
      <div style={S.card}>
        <div style={S.brand}>Shomee</div>
        <h1 style={S.h1}>{claimed ? 'Brief déjà dans l’app ✓' : 'Votre recherche est prête'}</h1>
        <p style={S.sub}>
          {claimed
            ? 'Ce brief a déjà été récupéré dans l’application. Ouvrez SHOMEE pour retrouver votre feed.'
            : 'Voici ce que votre assistant a transmis à SHOMEE. Ouvrez l’app pour découvrir les biens qui correspondent.'}
        </p>

        <section style={S.section}>
          <div style={S.row}><span style={S.key}>Zone</span><span style={S.val}>{brief.locationQuery ?? '—'}</span></div>
          <div style={S.row}>
            <span style={S.key}>Budget</span>
            <span style={S.val}>
              {brief.budgetMax ? `${brief.budgetMin ? euros(brief.budgetMin) + ' – ' : 'jusqu’à '}${euros(brief.budgetMax)}` : '—'}
            </span>
          </div>
          <div style={S.row}>
            <span style={S.key}>Surface</span>
            <span style={S.val}>{brief.minSurface ? `${brief.minSurface} m²${brief.maxSurface && brief.maxSurface < 999 ? ` – ${brief.maxSurface} m²` : ' et +'}` : '—'}</span>
          </div>
          <div style={S.rowLast}>
            <span style={S.key}>Pièces</span>
            <span style={S.val}>{brief.minRooms ? `${brief.minRooms} et +` : '—'}</span>
          </div>
          {criteria.length > 0 && (
            <>
              <div style={S.chips}>
                {criteria.slice(0, 10).map((c, i) => (
                  <span
                    key={i}
                    style={{ ...S.chip, ...(c.state === 2 ? S.chipMust : c.state === 3 ? S.chipNo : {}) }}
                  >
                    {c.state === 2 ? '● ' : ''}{c.label}
                  </span>
                ))}
                {criteria.length > 10 && <span style={S.chip}>+{criteria.length - 10}</span>}
              </div>
              <div style={S.legend}>● indispensable · barré = à éviter</div>
            </>
          )}
        </section>

        <HandoffActions token={token} code={code} claimed={claimed} />

        <p style={S.expiry}>Brief valable jusqu’au {frDate(handoff.expiresAt)} · code {code}</p>
      </div>
    </main>
  )
}
