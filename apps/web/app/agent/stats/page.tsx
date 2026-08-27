import Link from 'next/link'
import { Eye, FileText, Heart, MessageCircle, CalendarCheck, Video, AlertCircle } from 'lucide-react'
import { requireAgentOrRedirect } from '@/lib/auth/agentGuard'
import { statsPortefeuille, part, type LigneBien } from '@/lib/agent/stats'
import { couleurs, SERIF } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * L'onglet Stats — jusqu'ici une page inexistante (404 depuis la barre du bas).
 *
 * PARTI PRIS : un agent n'a pas besoin d'un tableau de chiffres, il a besoin de
 * savoir OÙ ÇA COINCE. L'écran raconte donc un entonnoir — vu, ouvert, aimé,
 * contacté, visité — et met en tête les deux fuites qui se réparent en une
 * minute : un bien sans vidéo, un bien que personne n'a vu.
 *
 * Les chiffres viennent de `lib/agent/stats`, la MÊME agrégation que l'outil
 * MCP `shomee_tableau_de_bord`. Poser la question à Claude ou ouvrir cet écran
 * donne le même nombre — sinon l'agent cesse de croire aux deux.
 */

const PERIODES = [7, 30, 90] as const

function lirePeriode(raw: string | string[] | undefined): number {
  const v = Number(Array.isArray(raw) ? raw[0] : raw)
  return PERIODES.includes(v as (typeof PERIODES)[number]) ? v : 30
}

const nb = (n: number) => n.toLocaleString('fr-FR')

/** Une marche de l'entonnoir : barre proportionnelle + conversion depuis le haut. */
function Marche({
  libelle,
  valeur,
  reference,
  taux,
  icone: Icone,
  fort = false,
}: {
  libelle: string
  valeur: number
  reference: number
  taux: number | null
  icone: typeof Eye
  fort?: boolean
}) {
  // 3 % de plancher : une valeur non nulle doit toujours se voir.
  const largeur = reference > 0 ? Math.max(3, Math.round((valeur / reference) * 100)) : 0
  return (
    <div className="py-2.5">
      <div className="flex items-baseline gap-2">
        <Icone size={14} style={{ color: couleurs.doux }} className="flex-none self-center" />
        <span className="text-[13px] flex-1" style={{ color: couleurs.encre }}>{libelle}</span>
        {taux !== null && (
          <span className="text-[11.5px] tabular-nums" style={{ color: couleurs.estompe }}>
            {taux} %
          </span>
        )}
        <span
          className="tabular-nums text-right"
          style={{ fontFamily: SERIF, fontSize: 20, color: couleurs.encre, minWidth: 52 }}
        >
          {nb(valeur)}
        </span>
      </div>
      <div className="h-[5px] rounded-full mt-1.5 overflow-hidden" style={{ backgroundColor: couleurs.sable }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${largeur}%`,
            backgroundColor: fort ? couleurs.vert : couleurs.terracotta,
            opacity: valeur === 0 ? 0.18 : 1,
          }}
        />
      </div>
    </div>
  )
}

function LigneClassement({ ligne, max }: { ligne: LigneBien; max: number }) {
  const largeur = max > 0 ? Math.max(2, Math.round((ligne.vues / max) * 100)) : 0
  const chiffres: Array<[typeof Eye, number]> = [
    [Eye, ligne.vues],
    [FileText, ligne.fiches],
    [Heart, ligne.favoris],
    [MessageCircle, ligne.conversations],
    [CalendarCheck, ligne.visites],
  ]
  return (
    <Link
      href={`/agent/biens/${ligne.id}/editer`}
      className="block rounded-2xl px-4 py-3.5 active:opacity-80"
      style={{ backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[14px] font-semibold truncate flex-1" style={{ color: couleurs.encre }}>
          {ligne.titre}
        </span>
        {!ligne.video && (
          <span
            className="flex-none inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: '#F6E5E0', color: couleurs.alerte }}
          >
            <Video size={10} />
            sans vidéo
          </span>
        )}
      </div>
      <p className="text-[12px] mt-0.5" style={{ color: couleurs.doux }}>
        {ligne.arrondissement}
      </p>

      <div className="h-[4px] rounded-full mt-2.5 overflow-hidden" style={{ backgroundColor: couleurs.sable }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${largeur}%`, backgroundColor: couleurs.terracotta, opacity: ligne.vues === 0 ? 0.18 : 1 }}
        />
      </div>

      <div className="flex items-center gap-4 mt-2.5">
        {chiffres.map(([Icone, valeur], i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <Icone size={12} style={{ color: couleurs.estompe }} />
            <span
              className="text-[13px] tabular-nums"
              style={{ color: valeur > 0 ? couleurs.encre : couleurs.estompe }}
            >
              {nb(valeur)}
            </span>
          </span>
        ))}
      </div>
    </Link>
  )
}

export default async function AgentStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ jours?: string | string[] }>
}) {
  const agent = await requireAgentOrRedirect()
  const { jours: joursParam } = await searchParams
  const jours = lirePeriode(joursParam)

  const stats = await statsPortefeuille(agent.id, jours)
  const { totaux } = stats
  const sansVideo = stats.classement.filter((l) => !l.video)

  return (
    <main className="px-5 pt-safe-page pb-6 max-w-3xl mx-auto">
      <h1 className="mb-4" style={{ fontFamily: SERIF, fontSize: 27, color: couleurs.encre }}>
        Statistiques
      </h1>

      {/* Période — de simples liens : aucun JavaScript pour changer de fenêtre. */}
      <div className="flex gap-2 mb-6">
        {PERIODES.map((p) => {
          const actif = p === jours
          return (
            <Link
              key={p}
              href={`/agent/stats?jours=${p}`}
              className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
              style={
                actif
                  ? { backgroundColor: couleurs.encre, color: couleurs.cremeSurSombre }
                  : { backgroundColor: couleurs.carte, color: couleurs.doux, border: `1px solid ${couleurs.ligne}` }
              }
            >
              {p} jours
            </Link>
          )
        })}
      </div>

      {stats.biensActifs === 0 ? (
        <div
          className="rounded-3xl p-7 text-center"
          style={{ backgroundColor: couleurs.carte, border: `1px dashed ${couleurs.ligne}` }}
        >
          <p className="text-[14px]" style={{ color: couleurs.doux }}>
            Aucun bien actif — il n’y a donc rien à mesurer pour l’instant.
          </p>
          <p className="text-[12px] mt-1.5" style={{ color: couleurs.estompe }}>
            Créez un bien avec le bouton « + », publiez-le, et ses chiffres apparaîtront ici.
          </p>
        </div>
      ) : (
        <>
          {/* ── L'entonnoir ─────────────────────────────────────────────── */}
          <section
            className="rounded-3xl px-5 py-4 mb-4"
            style={{ backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }}
          >
            <div
              className="text-[11px] font-bold uppercase mb-1"
              style={{ color: couleurs.terracotta, letterSpacing: '1.8px' }}
            >
              Le parcours
            </div>
            <p className="text-[12.5px] leading-snug mb-2" style={{ color: couleurs.doux }}>
              De la vidéo vue à la visite calée, sur {jours} jours. Le pourcentage compare chaque
              marche à celle du dessus.
            </p>

            <div style={{ borderTop: `1px solid ${couleurs.ligneDouce}` }}>
              <Marche
                libelle="Vidéos vues"
                valeur={totaux.vues}
                reference={totaux.vues}
                taux={null}
                icone={Eye}
              />
              <Marche
                libelle="Annonces ouvertes"
                valeur={totaux.fiches}
                reference={totaux.vues}
                taux={part(totaux.fiches, totaux.vues)}
                icone={FileText}
              />
              <Marche
                libelle="Mises en favori"
                valeur={totaux.favoris}
                reference={totaux.vues}
                taux={part(totaux.favoris, totaux.fiches)}
                icone={Heart}
              />
              <Marche
                libelle="Conversations"
                valeur={totaux.conversations}
                reference={totaux.vues}
                taux={part(totaux.conversations, totaux.fiches)}
                icone={MessageCircle}
              />
              <Marche
                libelle="Visites confirmées"
                valeur={totaux.visites}
                reference={totaux.vues}
                taux={part(totaux.visites, totaux.conversations)}
                icone={CalendarCheck}
                fort
              />
            </div>
          </section>

          {/* ── Repères ─────────────────────────────────────────────────── */}
          <section className="grid grid-cols-2 gap-2 mb-4">
            <div
              className="rounded-2xl px-4 py-3"
              style={{ backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }}
            >
              <p className="text-[9.5px] font-bold uppercase" style={{ color: couleurs.estompe, letterSpacing: '1.2px' }}>
                Médiane par bien
              </p>
              <p className="leading-none mt-1.5" style={{ fontFamily: SERIF, fontSize: 26, color: couleurs.encre }}>
                {nb(stats.medianeVues)}
              </p>
              <p className="text-[11px] mt-1" style={{ color: couleurs.doux }}>vues</p>
            </div>
            <div
              className="rounded-2xl px-4 py-3"
              style={{ backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }}
            >
              <p className="text-[9.5px] font-bold uppercase" style={{ color: couleurs.estompe, letterSpacing: '1.2px' }}>
                Partages
              </p>
              <p className="leading-none mt-1.5" style={{ fontFamily: SERIF, fontSize: 26, color: couleurs.encre }}>
                {nb(totaux.partages)}
              </p>
              <p className="text-[11px] mt-1" style={{ color: couleurs.doux }}>depuis l’app</p>
            </div>
          </section>

          {/* ── Ce qui coince ───────────────────────────────────────────── */}
          {(sansVideo.length > 0 || stats.sansVue.length > 0) && (
            <section
              className="rounded-3xl px-5 py-4 mb-4"
              style={{ backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }}
            >
              <div
                className="text-[11px] font-bold uppercase mb-2.5 flex items-center gap-1.5"
                style={{ color: couleurs.alerte, letterSpacing: '1.8px' }}
              >
                <AlertCircle size={13} />
                À traiter
              </div>
              {sansVideo.length > 0 && (
                <p className="text-[13.5px] leading-snug mb-2" style={{ color: couleurs.encre }}>
                  <b>{sansVideo.length} bien{sansVideo.length > 1 ? 's' : ''} sans vidéo</b> — sans
                  vidéo, une annonce ne peut pas tourner dans le feed : {sansVideo.map((l) => l.titre).join(', ')}.
                </p>
              )}
              {stats.sansVue.length > 0 && (
                <p className="text-[13.5px] leading-snug" style={{ color: couleurs.encre }}>
                  <b>{stats.sansVue.length} bien{stats.sansVue.length > 1 ? 's' : ''} sans aucune vue</b> sur
                  la période : {stats.sansVue.map((l) => l.titre).join(', ')}.
                </p>
              )}
            </section>
          )}

          {/* ── Le classement ───────────────────────────────────────────── */}
          <h2
            className="mb-3 mt-6"
            style={{ fontFamily: SERIF, fontSize: 19, color: couleurs.encre }}
          >
            Bien par bien
          </h2>
          <div className="flex flex-col gap-2.5">
            {stats.classement.map((l) => (
              <LigneClassement key={l.id} ligne={l} max={stats.classement[0]?.vues ?? 0} />
            ))}
          </div>

          <p className="text-[11.5px] leading-relaxed mt-5" style={{ color: couleurs.estompe }}>
            Vues = lancements de la vidéo dans le feed. Les conversations comptent tous les fils
            ouverts sur le bien, sans limite de date ; tout le reste est mesuré sur les {jours}{' '}
            derniers jours.
          </p>
        </>
      )}
    </main>
  )
}
