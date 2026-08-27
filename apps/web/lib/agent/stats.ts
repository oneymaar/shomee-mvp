import { prisma } from '@/lib/prisma'
import { PropertyStatus } from '@prisma/client'

/**
 * Les chiffres du portefeuille d'un agent — UNE seule agrégation, deux
 * consommateurs : l'écran Stats du back-office et l'outil MCP
 * `shomee_tableau_de_bord`. Deux calculs séparés, c'est deux réponses
 * différentes à la même question — le piège qui a déjà coûté cher sur les
 * libellés d'arrondissement.
 *
 * Tout est compté EN BASE. Rien n'est estimé, rien n'est simulé : un compte
 * neuf affiche des zéros, et c'est la bonne réponse.
 */

export type LigneBien = {
  id: string
  titre: string
  arrondissement: string
  prix: number
  statut: PropertyStatus
  /** Une annonce sans vidéo ne peut pas tourner dans le feed. */
  video: boolean
  vues: number
  fiches: number
  favoris: number
  partages: number
  conversations: number
  visites: number
}

export type Totaux = {
  vues: number
  fiches: number
  favoris: number
  partages: number
  conversations: number
  visites: number
}

export type StatsPortefeuille = {
  jours: number
  biensActifs: number
  totaux: Totaux
  medianeVues: number
  /** Les biens que personne n'a vus sur la période — le vrai signal d'alerte. */
  sansVue: LigneBien[]
  /** Du plus vu au moins vu. */
  classement: LigneBien[]
}

type Compteurs = Record<string, number>

function compte(c: Compteurs | undefined, type: string): number {
  return c?.[type] ?? 0
}

/** Médiane entière — 0 si l'échantillon est vide. */
export function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0
  const tri = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(tri.length / 2)
  return tri.length % 2 === 1 ? tri[milieu] : Math.round((tri[milieu - 1] + tri[milieu]) / 2)
}

/** Part en pourcentage, arrondie. `null` quand le dénominateur est nul. */
export function part(numerateur: number, denominateur: number): number | null {
  return denominateur > 0 ? Math.round((numerateur / denominateur) * 100) : null
}

/** Une seule agrégation SQL pour tout le portefeuille. */
async function evenementsParBien(ids: string[], depuis: Date): Promise<Map<string, Compteurs>> {
  const parBien = new Map<string, Compteurs>()
  if (ids.length === 0) return parBien
  const lignes = await prisma.interactionEvent.groupBy({
    by: ['propertyId', 'type'],
    where: { propertyId: { in: ids }, createdAt: { gte: depuis } },
    _count: { _all: true },
  })
  for (const l of lignes) {
    if (!l.propertyId) continue
    const c = parBien.get(l.propertyId) ?? {}
    c[l.type] = (c[l.type] ?? 0) + l._count._all
    parBien.set(l.propertyId, c)
  }
  return parBien
}

export async function statsPortefeuille(
  agentId: string,
  jours = 30,
  maintenant = Date.now(),
): Promise<StatsPortefeuille> {
  const depuis = new Date(maintenant - jours * 86400_000)

  const biens = await prisma.property.findMany({
    where: { createdByAgentId: agentId, statut: { not: PropertyStatus.ARCHIVED } },
    select: { id: true, title: true, arrondissement: true, price: true, statut: true, videoUrl: true },
  })

  const vide: StatsPortefeuille = {
    jours,
    biensActifs: 0,
    totaux: { vues: 0, fiches: 0, favoris: 0, partages: 0, conversations: 0, visites: 0 },
    medianeVues: 0,
    sansVue: [],
    classement: [],
  }
  if (biens.length === 0) return vide

  const ids = biens.map((b) => b.id)

  const [parBien, conversations, visites] = await Promise.all([
    evenementsParBien(ids, depuis),
    prisma.conversation.groupBy({ by: ['propertyId'], where: { agentId }, _count: { _all: true } }),
    prisma.visit.groupBy({
      by: ['propertyId'],
      where: { agentId, status: 'CONFIRMED', scheduledAt: { gte: depuis } },
      _count: { _all: true },
    }),
  ])
  const convParBien = new Map(conversations.map((l) => [l.propertyId, l._count._all]))
  const visParBien = new Map(visites.map((l) => [l.propertyId, l._count._all]))

  const classement: LigneBien[] = biens
    .map((b) => {
      const c = parBien.get(b.id)
      return {
        id: b.id,
        titre: b.title,
        arrondissement: b.arrondissement,
        prix: b.price,
        statut: b.statut,
        video: Boolean(b.videoUrl),
        vues: compte(c, 'video_start'),
        fiches: compte(c, 'detail_open'),
        // Net : un bien « défavorisé » ne doit pas rester crédité du like.
        favoris: Math.max(0, compte(c, 'fav') - compte(c, 'unfav')),
        partages: compte(c, 'share'),
        conversations: convParBien.get(b.id) ?? 0,
        visites: visParBien.get(b.id) ?? 0,
      }
    })
    .sort((a, b) => b.vues - a.vues)

  const somme = (cle: keyof Totaux): number =>
    classement.reduce((t, l) => t + l[cle], 0)

  return {
    jours,
    biensActifs: classement.length,
    totaux: {
      vues: somme('vues'),
      fiches: somme('fiches'),
      favoris: somme('favoris'),
      partages: somme('partages'),
      conversations: somme('conversations'),
      visites: somme('visites'),
    },
    medianeVues: mediane(classement.map((l) => l.vues)),
    sansVue: classement.filter((l) => l.vues === 0),
    classement,
  }
}
