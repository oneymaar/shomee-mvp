import { describe, it, expect, avant, executer } from './harnais.ts'
import { base, brancherJointureCle } from './doublePrisma.ts'
import { parisLocalToUtc } from '@/lib/chat/parisTime'

// Le secret partagé doit exister AVANT l'import de la route.
process.env.MCP_PRIVATE_KEY = 'secret-de-test-suffisamment-long'

const CLE_A = 'shomee_cleAgentA'
const CLE_B = 'shomee_cleAgentB'

let POST: (req: Request) => Promise<Response>

// ─── Jeu d'essai ───────────────────────────────────────────────────────────

function bienFactice(id: string, agentId: string, titre: string) {
  return {
    id,
    title: titre,
    arrondissement: 'PARIS 12e',
    district: 'Aligre',
    price: 890_000,
    surface: 74,
    rooms: 3,
    statut: 'PUBLISHED',
    videoUrl: 'https://exemple/video.mp4',
    completionRate: 0.8,
    updatedAt: new Date(),
    description: 'x'.repeat(300),
    gallery: ['a.jpg'],
    floor: 3,
    yearBuilt: 1900,
    monthlyCharges: 210,
    propertyTax: 1300,
    composition: [{ label: 'Séjour', surface: 30 }],
    createdByAgentId: agentId,
    agencyId: agentId === 'a1' ? 'ag1' : 'ag2',
  }
}

avant(async () => {
  brancherJointureCle()
  base.agency.lignes.push({ id: 'ag1', name: 'Kretz Real Estate', maxProperties: 50 })
  base.agency.lignes.push({ id: 'ag2', name: 'Agence Confrère', maxProperties: 50 })
  base.agent.lignes.push({ id: 'a1', name: 'Olivier Kretz', agencyId: 'ag1', avatar: null })
  base.agent.lignes.push({ id: 'a2', name: 'Confrère', agencyId: 'ag2', avatar: null })
  base.agentApiKey.lignes.push({ id: 'k1', agentId: 'a1', key: CLE_A, label: 'Connecteur IA', createdAt: new Date(), lastUsed: null })
  base.agentApiKey.lignes.push({ id: 'k2', agentId: 'a2', key: CLE_B, label: 'Connecteur IA', createdAt: new Date(), lastUsed: null })
  base.property.lignes.push(bienFactice('P1', 'a1', 'Rue de Cîteaux'))
  base.property.lignes.push(bienFactice('P2', 'a2', 'Bien du confrère'))
  base.user.lignes.push({ id: 'U1', name: 'Mme Bernard', email: 'b@ex.fr', isGuest: false })
  base.conversation.lignes.push({
    id: 'C1', propertyId: 'P1', buyerUserId: 'U1', agentId: 'a1',
    createdAt: new Date(), lastMessageAt: new Date(), buyerLastReadAt: null, agentLastReadAt: null,
  })
  base.conversation.lignes.push({
    id: 'C2', propertyId: 'P2', buyerUserId: 'U1', agentId: 'a2',
    createdAt: new Date(), lastMessageAt: new Date(), buyerLastReadAt: null, agentLastReadAt: null,
  })
  base.message.lignes.push({
    id: 'M1', conversationId: 'C1', sender: 'BUYER', kind: 'VISIT_REQUEST',
    text: 'Bonjour, j’aimerais organiser une visite.', payload: {}, createdAt: new Date(Date.now() - 7200_000),
  })
  base.message.lignes.push({
    id: 'M2', conversationId: 'C1', sender: 'BUYER', kind: 'AVAILABILITIES',
    text: 'Mes disponibilités', payload: { days: [{ date: '2026-08-28', slots: ['morning'] }] },
    createdAt: new Date(Date.now() - 3600_000),
  })

  POST = (await import('@/app/api/mcp/route')).POST
})

// ─── Dialogue JSON-RPC réel ────────────────────────────────────────────────

let idRpc = 0

async function rpc(
  url: string,
  methode: string,
  params?: unknown,
  entetes: Record<string, string> = {},
): Promise<{ statut: number; corps: unknown }> {
  const res = await POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...entetes },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++idRpc, method: methode, params: params ?? {} }),
    }),
  )
  if (res.status !== 200) return { statut: res.status, corps: null }
  const texte = await res.text()
  const json = texte.startsWith('event:') || texte.startsWith('data:')
    ? JSON.parse(texte.split('\n').find((l) => l.startsWith('data:'))!.slice(5).trim())
    : JSON.parse(texte)
  return { statut: res.status, corps: json }
}

/** Un échange complet : initialize puis l'appel voulu (mode sans état). */
async function appeler(url: string, methode: string, params?: unknown) {
  await rpc(url, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'banc', version: '1' },
  })
  return rpc(url, methode, params)
}

function texteOutil(corps: unknown): string {
  const r = corps as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: unknown }
  if (r.error) return `ERREUR-RPC ${JSON.stringify(r.error)}`
  return r.result?.content?.[0]?.text ?? ''
}

function nomsOutils(corps: unknown): string[] {
  const r = corps as { result?: { tools?: Array<{ name: string }> } }
  return (r.result?.tools ?? []).map((t) => t.name)
}

const urlAgentA = `https://test.local/api/mcp?k=${CLE_A}&client=claude`
const urlAgentB = `https://test.local/api/mcp?k=${CLE_B}&client=claude`
const urlOlivier = `https://test.local/api/mcp?k=${process.env.MCP_PRIVATE_KEY}`

// ─── La garde d'accès ──────────────────────────────────────────────────────

describe("la garde d'accès", () => {
  it('refuse sans clé, en 404 — la route ne doit pas révéler son existence', async () => {
    const { statut } = await rpc('https://test.local/api/mcp', 'initialize')
    expect(statut).toBe(404)
  })

  it('refuse une clé inconnue', async () => {
    const { statut } = await rpc('https://test.local/api/mcp?k=shomee_inventee', 'initialize')
    expect(statut).toBe(404)
  })

  it('ouvre le profil acquéreur avec le secret partagé', async () => {
    const { corps } = await appeler(urlOlivier, 'tools/list')
    const outils = nomsOutils(corps)
    expect(outils).toContain('shomee_guide_brief')
    expect(outils).not.toContain('shomee_ma_journee')
  })

  it('ouvre le profil admin avec le secret partagé et profil=admin', async () => {
    const { corps } = await appeler(`${urlOlivier}&profil=admin`, 'tools/list')
    expect(nomsOutils(corps)).toContain('shomee_entonnoir_handoff')
  })

  it("ouvre le profil agent avec une clé d'agent", async () => {
    const { corps } = await appeler(urlAgentA, 'tools/list')
    const outils = nomsOutils(corps)
    expect(outils).toContainTous([
      'shomee_ma_journee', 'shomee_mes_conversations', 'shomee_lire_conversation',
      'shomee_repondre', 'shomee_confirmer_visite', 'shomee_mes_visites',
      'shomee_annuler_visite', 'shomee_creer_annonce', 'shomee_lister_biens',
      'shomee_performance_bien', 'shomee_tableau_de_bord',
    ])
  })

  it("interdit à une clé d'agent de se hisser en admin via l'URL", async () => {
    const { corps } = await appeler(`${urlAgentA}&profil=admin`, 'tools/list')
    const outils = nomsOutils(corps)
    expect(outils).not.toContain('shomee_entonnoir_handoff')
    expect(outils).toContain('shomee_ma_journee')
  })

  it("annonce à l'agent sous quelle identité il est branché", async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', { name: 'shomee_ping', arguments: {} })
    expect(texteOutil(corps)).toContain('Olivier Kretz — Kretz Real Estate')
  })

  it("laisse une trace de vie sur la clé utilisée", async () => {
    const cle = base.agentApiKey.lignes.find((k) => k.key === CLE_A)
    expect(cle?.lastUsed).toBeInstanceOf(Date)
  })
})

// ─── Le cloisonnement ──────────────────────────────────────────────────────

describe('le cloisonnement entre agents', () => {
  it('laisse un agent lire son propre fil', async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_lire_conversation', arguments: { conversation_id: 'C1' },
    })
    expect(texteOutil(corps)).toContain('Mme Bernard')
  })

  it("cache le fil d'un confrère, sans dire qu'il existe", async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_lire_conversation', arguments: { conversation_id: 'C2' },
    })
    expect(texteOutil(corps)).toBe('Fil introuvable.')
  })

  it("refuse de répondre dans le fil d'un confrère", async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_repondre', arguments: { conversation_id: 'C2', texte: 'Bonjour' },
    })
    expect(texteOutil(corps)).toBe('Fil introuvable.')
    expect(base.message.lignes.filter((m) => m.conversationId === 'C2')).toHaveLength(0)
  })

  it("cache le bien d'un confrère", async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_performance_bien', arguments: { bien_id: 'P2' },
    })
    expect(texteOutil(corps)).toBe('Bien introuvable.')
  })

  it('ne liste que les biens de son porteur', async () => {
    const { corps } = await appeler(urlAgentB, 'tools/call', { name: 'shomee_lister_biens', arguments: {} })
    const texte = texteOutil(corps)
    expect(texte).toContain('Bien du confrère')
    expect(texte).not.toContain('Rue de Cîteaux')
  })
})

// ─── L'heure, le piège principal ───────────────────────────────────────────

describe("l'heure de Paris", () => {
  it("applique l'heure d'été (UTC+2)", () => {
    expect(parisLocalToUtc('2026-08-28T10:30')?.toISOString()).toBe('2026-08-28T08:30:00.000Z')
  })

  it("applique l'heure d'hiver (UTC+1)", () => {
    expect(parisLocalToUtc('2026-01-15T10:30')?.toISOString()).toBe('2026-01-15T09:30:00.000Z')
  })

  it('reste juste le jour du changement d’heure', () => {
    // Bascule 2026 : dimanche 25 octobre à 3 h → 2 h.
    expect(parisLocalToUtc('2026-10-25T01:30')?.toISOString()).toBe('2026-10-24T23:30:00.000Z')
    expect(parisLocalToUtc('2026-10-25T04:30')?.toISOString()).toBe('2026-10-25T03:30:00.000Z')
  })

  it('rejette un format libre', () => {
    expect(parisLocalToUtc('jeudi 10h30')).toBeNull()
    expect(parisLocalToUtc('2026-08-28T10:30:00Z')).toBeNull()
  })
})

// ─── Caler une visite ──────────────────────────────────────────────────────

describe('caler une visite', () => {
  it('refuse une date déjà passée plutôt que de créer un rendez-vous absurde', async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_confirmer_visite', arguments: { conversation_id: 'C1', date_heure_paris: '2020-03-04T10:30' },
    })
    expect(texteOutil(corps)).toContain('déjà passée')
    expect(base.visit.lignes).toHaveLength(0)
  })

  it('refuse un format d’heure inexploitable', async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_confirmer_visite', arguments: { conversation_id: 'C1', date_heure_paris: 'jeudi matin' },
    })
    // Bloqué par le schéma d'entrée : le modèle reçoit l'erreur, pas la base.
    expect(texteOutil(corps)).toMatch(/AAAA-MM-JJ|invalid|Invalid/)
    expect(base.visit.lignes).toHaveLength(0)
  })

  it('crée la visite à la bonne heure de Paris et poste la confirmation', async () => {
    const dansUnMois = new Date(Date.now() + 30 * 86400_000)
    const jour = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(dansUnMois)

    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_confirmer_visite',
      arguments: { conversation_id: 'C1', date_heure_paris: `${jour}T10:30`, duree_min: 45 },
    })
    expect(texteOutil(corps)).toContain('10 h 30')

    expect(base.visit.lignes).toHaveLength(1)
    const visite = base.visit.lignes[0]
    expect(visite.agentId).toBe('a1')
    expect(visite.durationMin).toBe(45)
    // L'instant stocké doit bien se relire « 10:30 » à Paris.
    const relu = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(visite.scheduledAt as Date)
    expect(relu).toBe('10:30')

    const confirmation = base.message.lignes.find((m) => m.kind === 'VISIT_CONFIRMED')
    expect(confirmation?.conversationId).toBe('C1')
    expect(confirmation?.sender).toBe('AGENT')
  })
})

// ─── Répondre ──────────────────────────────────────────────────────────────

describe('répondre à un acquéreur', () => {
  it('écrit le message et marque le fil comme lu', async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_repondre', arguments: { conversation_id: 'C1', texte: 'Bonjour, je vous rappelle ce soir.' },
    })
    expect(texteOutil(corps)).toContain('envoye')

    const envoye = base.message.lignes.filter((m) => m.kind === 'TEXT' && m.conversationId === 'C1')
    expect(envoye).toHaveLength(1)
    expect(envoye[0].sender).toBe('AGENT')

    const fil = base.conversation.lignes.find((c) => c.id === 'C1')
    expect(fil?.agentLastReadAt).toBeInstanceOf(Date)
  })
})

// ─── Le point du matin ─────────────────────────────────────────────────────

describe('le point du matin', () => {
  it("signale une demande dont les disponibilités sont arrivées", async () => {
    // Fil neuf, sans visite calée : demande + disponibilités.
    base.conversation.lignes.push({
      id: 'C3', propertyId: 'P1', buyerUserId: 'U1', agentId: 'a1',
      createdAt: new Date(), lastMessageAt: new Date(), buyerLastReadAt: null, agentLastReadAt: null,
    })
    base.message.lignes.push({
      id: 'M10', conversationId: 'C3', sender: 'BUYER', kind: 'VISIT_REQUEST',
      text: 'Visite ?', payload: {}, createdAt: new Date(Date.now() - 5000),
    })
    base.message.lignes.push({
      id: 'M11', conversationId: 'C3', sender: 'BUYER', kind: 'AVAILABILITIES',
      text: 'Dispos', payload: { days: [{ date: '2026-08-28', slots: ['morning', 'lunch'] }] },
      createdAt: new Date(Date.now() - 4000),
    })

    const { corps } = await appeler(urlAgentA, 'tools/call', { name: 'shomee_ma_journee', arguments: {} })
    const texte = texteOutil(corps)
    expect(texte).toContain('À CALER')
    expect(texte).toContain('matinée')
    expect(texte).toContain('maintenant_paris')
  })
})

/** Événements d'audience du banc — posés une seule fois, à la volée. */
function avantChiffres(): void {
  const il_y_a = (h: number) => new Date(Date.now() - h * 3600_000)
  const poser = (type: string, deviceId: string, h: number, valueMs?: number) =>
    base.interactionEvent.lignes.push({
      id: `e${base.interactionEvent.lignes.length + 1}`, deviceId, propertyId: 'P1', type,
      valueMs: valueMs ?? null, createdAt: il_y_a(h),
    })
  for (let i = 0; i < 9; i++) poser('video_start', `d${i % 4}`, 2)
  poser('video_start', 'd9', 480) // 20 jours : dans la fenêtre de 30, hors de celle de 1
  for (const ms of [4000, 6000, 8000]) poser('dwell', 'd0', 2, ms)
  for (let i = 0; i < 3; i++) poser('detail_open', `d${i}`, 2)
  poser('fav', 'd0', 2)
  poser('fav', 'd1', 2)
  poser('unfav', 'd1', 2)
}

// ─── Annuler ───────────────────────────────────────────────────────────────

describe('annuler une visite', () => {
  it("passe la visite en annulée et prévient l'acquéreur", async () => {
    const visite = base.visit.lignes[0]
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_annuler_visite', arguments: { visite_id: visite.id as string },
    })
    expect(texteOutil(corps)).toContain('annulee')
    expect(base.visit.lignes[0].status).toBe('CANCELLED')
    const avis = base.message.lignes.filter((m) => m.kind === 'SYSTEM')
    expect(avis).toHaveLength(1)
    expect(String(avis[0].text)).toContain("annulée par l'agence")
  })

  it("refuse d'annuler la visite d'un confrère", async () => {
    const { corps } = await appeler(urlAgentB, 'tools/call', {
      name: 'shomee_annuler_visite', arguments: { visite_id: base.visit.lignes[0].id as string },
    })
    expect(texteOutil(corps)).toBe('Visite introuvable.')
  })
})

// ─── Créer une annonce ─────────────────────────────────────────────────────

describe('créer une annonce', () => {
  it('crée un brouillon, jamais un bien publié', async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_creer_annonce',
      arguments: {
        adresse: '12 rue de Cîteaux, 75012 Paris',
        prix: 890000, surface: 74, nb_pieces: 3, nb_chambres: 2,
        type_bien: 'Appartement', description: 'Traversant, dernier étage.',
      },
    })
    const texte = texteOutil(corps)
    expect(texte).toContain('brouillon')
    expect(texte).toContain('/editer')

    const cree = base.property.lignes.find((b) => b.location === '12 rue de Cîteaux, 75012 Paris')
    expect(cree?.statut).toBe('DRAFT')
    expect(cree?.createdByAgentId).toBe('a1')
    // L'arrondissement se déduit du code postal, pas d'une supposition du modèle.
    expect(cree?.arrondissement).toBe('PARIS 12e')
    // Provenance marquée en bloc : on saura d'où vient cette fiche.
    expect(String(cree?.priceSource)).toContain('Claude')
  })

  it('refuse au-delà du quota de l’agence plutôt que de créer en silence', async () => {
    const agence = base.agency.lignes.find((a) => a.id === 'ag1')!
    const memoire = agence.maxProperties
    agence.maxProperties = 1
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_creer_annonce', arguments: { adresse: '1 rue Trop-Tard, 75012 Paris' },
    })
    expect(texteOutil(corps)).toContain('Quota atteint')
    agence.maxProperties = memoire
  })
})

// ─── Les chiffres ──────────────────────────────────────────────────────────

describe("les chiffres d'audience", () => {
  avantChiffres()

  it('compte les vues et le taux d’ouverture de fiche sans les faire calculer au modèle', async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_performance_bien', arguments: { bien_id: 'P1', jours: 30 },
    })
    const lu = JSON.parse(texteOutil(corps)) as Record<string, Record<string, unknown>>
    expect(lu.audience.vues).toBe(10)
    // d0..d3 sur les vues récentes + d9 sur la vue de 20 jours = 5 appareils.
    expect(lu.audience.spectateurs_uniques).toBe(5)
    expect(lu.interet.fiches_ouvertes).toBe(3)
    expect(lu.interet.taux_ouverture_fiche).toBe('30 %')
    // 2 favoris posés, 1 retiré.
    expect(lu.interet.favoris_nets).toBe(1)
    expect(lu.audience.temps_moyen_sur_la_video_s).toBe(6)
  })

  it('ignore les événements hors période', async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_performance_bien', arguments: { bien_id: 'P1', jours: 1 },
    })
    const lu = JSON.parse(texteOutil(corps)) as Record<string, Record<string, unknown>>
    expect(lu.audience.vues).toBe(9)
  })

  it('classe le portefeuille et signale les biens sans aucune vue', async () => {
    const { corps } = await appeler(urlAgentA, 'tools/call', {
      name: 'shomee_tableau_de_bord', arguments: { jours: 30 },
    })
    const lu = JSON.parse(texteOutil(corps)) as Record<string, unknown>
    const classement = lu.classement as Array<Record<string, unknown>>
    expect(classement[0].bien_id).toBe('P1')
    expect((lu.totaux as Record<string, unknown>).vues).toBe(10)
    expect((lu.biens_sans_aucune_vue as string[]).length).toBe(classement.length - 1)
  })
})


// ─── La clé en en-tête ─────────────────────────────────────────────────────

describe('la clé passée en en-tête', () => {
  const nu = 'https://test.local/api/mcp?client=claude'

  it('accepte Authorization: Bearer — l’adresse collée reste propre', async () => {
    await rpc(nu, 'initialize', {}, { Authorization: `Bearer ${CLE_A}` })
    const { corps } = await rpc(nu, 'tools/list', {}, { Authorization: `Bearer ${CLE_A}` })
    expect(nomsOutils(corps)).toContain('shomee_ma_journee')
  })

  it('accepte x-api-key', async () => {
    await rpc(nu, 'initialize', {}, { 'x-api-key': CLE_B })
    const { corps } = await rpc(nu, 'tools/call', { name: 'shomee_ping', arguments: {} }, { 'x-api-key': CLE_B })
    expect(texteOutil(corps)).toContain('Agence Confrère')
  })

  it('refuse toujours un en-tête porteur d’une clé inconnue', async () => {
    const { statut } = await rpc(nu, 'initialize', {}, { Authorization: 'Bearer shomee_inventee' })
    expect(statut).toBe(404)
  })
})


await executer()
