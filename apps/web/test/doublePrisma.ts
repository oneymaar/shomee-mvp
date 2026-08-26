/**
 * Double de Prisma en mémoire — juste assez pour faire tourner le vrai code du
 * connecteur sans base de données.
 *
 * Pourquoi pas la vraie base : ce banc doit pouvoir tourner hors ligne, être
 * déterministe, et surtout ne jamais écrire un message ou une visite chez un
 * vrai acquéreur. Ce sont pourtant les VRAIS handlers de /api/mcp qui sont
 * exercés, et le vrai protocole JSON-RPC : seule la couche de persistance est
 * remplacée.
 */

type Ligne = Record<string, unknown>

/** Filtre Prisma minimal : égalité, in, not, gte/gt/lte/lt, contains, OR. */
function correspond(ligne: Ligne, ou: unknown): boolean {
  if (!ou || typeof ou !== 'object') return true
  for (const [cle, attendu] of Object.entries(ou as Record<string, unknown>)) {
    if (cle === 'OR') {
      const liste = attendu as unknown[]
      if (!liste.some((sous) => correspond(ligne, sous))) return false
      continue
    }
    const valeur = ligne[cle]
    if (attendu instanceof Date) {
      if (!(valeur instanceof Date) || valeur.getTime() !== attendu.getTime()) return false
      continue
    }
    if (attendu !== null && typeof attendu === 'object') {
      const op = attendu as Record<string, unknown>
      if ('in' in op && !(op.in as unknown[]).includes(valeur as never)) return false
      if ('not' in op && valeur === op.not) return false
      if ('gte' in op && !(valeur instanceof Date && valeur >= (op.gte as Date))) return false
      if ('gt' in op && !(valeur instanceof Date && valeur > (op.gt as Date))) return false
      if ('lte' in op && !(valeur instanceof Date && valeur <= (op.lte as Date))) return false
      if ('lt' in op && !(valeur instanceof Date && valeur < (op.lt as Date))) return false
      if ('contains' in op) {
        const s = String(valeur ?? '').toLowerCase()
        if (!s.includes(String(op.contains).toLowerCase())) return false
      }
      continue
    }
    if (valeur !== attendu) return false
  }
  return true
}

function trier(lignes: Ligne[], orderBy: unknown): Ligne[] {
  if (!orderBy || typeof orderBy !== 'object') return lignes
  const [cle, sens] = Object.entries(orderBy as Record<string, string>)[0] ?? []
  if (!cle) return lignes
  return [...lignes].sort((a, b) => {
    const x: unknown = a[cle]
    const y: unknown = b[cle]
    let d: number
    if (x instanceof Date && y instanceof Date) d = x.getTime() - y.getTime()
    else d = String(x) > String(y) ? 1 : String(x) < String(y) ? -1 : 0
    return sens === 'desc' ? -d : d
  })
}

let compteur = 0
const nouvelId = (prefixe: string) => `${prefixe}_${++compteur}`

export class Table {
  lignes: Ligne[] = []
  prefixe: string
  // Pas de « constructor(private x) » : Node retire les types sans les
  // transformer, et cette sucrerie TypeScript n'y survit pas.
  constructor(prefixe: string) {
    this.prefixe = prefixe
  }

  async findMany(args: { where?: unknown; orderBy?: unknown; take?: number; select?: unknown; distinct?: unknown } = {}) {
    const r = trier(this.lignes.filter((l) => correspond(l, args.where)), args.orderBy)
    return (args.take ? r.slice(0, args.take) : r) as never[]
  }
  async findUnique(args: { where: Ligne; include?: unknown; select?: unknown }) {
    const trouve = this.lignes.find((l) => correspond(l, args.where)) ?? null
    return (trouve ? { ...trouve } : null) as never
  }
  async findFirst(args: { where?: unknown; orderBy?: unknown } = {}) {
    const r = trier(this.lignes.filter((l) => correspond(l, args.where)), args.orderBy)
    return (r[0] ?? null) as never
  }
  async count(args: { where?: unknown } = {}) {
    return this.lignes.filter((l) => correspond(l, args.where)).length
  }
  async create(args: { data: Ligne }) {
    const ligne: Ligne = { id: nouvelId(this.prefixe), createdAt: new Date(), ...args.data }
    this.lignes.push(ligne)
    return { ...ligne } as never
  }
  async update(args: { where: Ligne; data: Ligne }) {
    const ligne = this.lignes.find((l) => correspond(l, args.where))
    if (!ligne) throw new Error('Ligne introuvable')
    Object.assign(ligne, args.data)
    return { ...ligne } as never
  }
  async deleteMany(args: { where?: unknown } = {}) {
    const avant = this.lignes.length
    this.lignes = this.lignes.filter((l) => !correspond(l, args.where))
    return { count: avant - this.lignes.length }
  }
  async groupBy(args: { by: string[]; where?: unknown; _count?: unknown; _avg?: Record<string, boolean> }) {
    const filtrees = this.lignes.filter((l) => correspond(l, args.where))
    const paquets = new Map<string, Ligne[]>()
    for (const l of filtrees) {
      const clef = args.by.map((c) => String(l[c])).join('§')
      paquets.set(clef, [...(paquets.get(clef) ?? []), l])
    }
    return [...paquets.entries()].map(([clef, lignes]) => {
      const sortie: Ligne = {}
      clef.split('§').forEach((v, i) => (sortie[args.by[i]] = v === 'null' ? null : v))
      if (args._count) sortie._count = { _all: lignes.length }
      if (args._avg) {
        const champ = Object.keys(args._avg)[0]
        const valeurs = lignes.map((l) => l[champ]).filter((v): v is number => typeof v === 'number')
        sortie._avg = { [champ]: valeurs.length ? valeurs.reduce((a, b) => a + b, 0) / valeurs.length : null }
      }
      return sortie
    }) as never[]
  }
}

export const base = {
  agentApiKey: new Table('key'),
  agent: new Table('agent'),
  agency: new Table('agency'),
  property: new Table('prop'),
  user: new Table('user'),
  conversation: new Table('conv'),
  message: new Table('msg'),
  visit: new Table('visit'),
  interactionEvent: new Table('evt'),
  shareView: new Table('share'),
  handoff: new Table('handoff'),
  $queryRaw: async () => [{ '?column?': 1 }],
}

/**
 * `include: { agent: { include: { agency: true } } }` sur les clés d'API —
 * seule jointure dont le connecteur a besoin, recomposée à la main.
 */
export function brancherJointureCle(): void {
  const table = base.agentApiKey
  const brut = table.findUnique.bind(table)
  table.findUnique = async (args: { where: Ligne; include?: unknown }) => {
    const cle = (await brut(args)) as Ligne | null
    if (!cle) return null as never
    if (!args.include) return cle as never
    const agent = base.agent.lignes.find((a) => a.id === cle.agentId)
    const agency = agent ? base.agency.lignes.find((g) => g.id === agent.agencyId) : undefined
    return { ...cle, agent: { ...agent, agency } } as never
  }
}

export function reinitialiser(): void {
  for (const valeur of Object.values(base)) {
    if (valeur instanceof Table) valeur.lignes = []
  }
}
