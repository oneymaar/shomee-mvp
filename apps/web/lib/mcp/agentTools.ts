/**
 * Outils MCP du profil AGENT — ce que l'agent immobilier peut faire depuis
 * Claude ou ChatGPT, sans jamais ouvrir le back-office.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TROIS MÉTIERS, PAS UN
 *   · SAISIE     — dicter un mandat, retrouver ses biens          (hebdomadaire)
 *   · PILOTAGE   — répondre aux acquéreurs, caler les visites      (quotidien)
 *   · ANALYSE    — comprendre pourquoi un bien décolle ou pas      (hebdomadaire)
 * Le pilotage est le seul usage QUOTIDIEN : c'est lui qui justifie l'installation
 * du connecteur, les deux autres en profitent.
 *
 * L'HEURE EST LE PIÈGE PRINCIPAL
 * Dans le back-office, c'est le navigateur de l'agent qui convertit l'heure
 * locale en UTC. Un LLM n'a pas de navigateur, et il n'a pas non plus la notion
 * du jour courant. Deux garde-fous en conséquence : (1) tout outil sensible au
 * temps renvoie `maintenant_paris`, sinon « jeudi » ne veut rien dire ; (2)
 * `shomee_confirmer_visite` n'accepte QUE de l'heure locale parisienne et fait
 * la conversion lui-même. Accepter un ISO UTC fabriqué par le modèle, ce serait
 * se tromper d'une heure la moitié de l'année, sur de vrais rendez-vous.
 *
 * LE CLOISONNEMENT NE SE DISCUTE PAS
 * Chaque requête est filtrée par `agent.id`, dérivé de la clé authentifiée.
 * Aucun outil n'accepte d'identifiant d'agent ou d'agence en paramètre : un
 * modèle passerait volontiers celui d'une autre agence, halluciné ou soufflé
 * par une injection de prompt. Une fuite ici termine un pilote B2B.
 *
 * LE SERVEUR CALCULE, LE MODÈLE INTERPRÈTE
 * Les outils d'analyse renvoient des valeurs finales, jamais des lignes à
 * sommer — sinon la même question donne deux réponses à deux jours d'écart et
 * l'agent cesse d'y croire. Les repères de comparaison (médiane du
 * portefeuille) sont calculés ici aussi, pour que « deux fois moins que vos
 * autres biens » soit un fait et pas une impression du modèle.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { PropertyStatus, type Agent, type Agency, type Message } from '@prisma/client'
import { formatVisitDateParis, parisLocalToUtc, repereParis } from '@/lib/chat/parisTime'
import { newSetupToken } from '@/lib/auth/agentPassword'
import { formatAvailabilities, type AvailabilitiesPayload } from '@shomee/core/visits'
import {
  ImportLLMSchema,
  creerBienDepuisLLM,
  verifierQuota,
  type ImportPayload,
} from '@/lib/biens/importLlm'

type AgentConnecte = Agent & { agency: Agency }

// ─── Présentation ──────────────────────────────────────────────────────────

function resultatTexte(payload: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function euros(n: number): string {
  return `${n.toLocaleString('fr-FR')} €`
}

function heureParis(d: Date): string {
  return d.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function jourParis(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function pourcent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)} %` : 'n/a'
}

/** Un fil dont la dernière demande de visite n'a pas encore de créneau. */
type EtatFil = 'rien_a_faire' | 'attente_disponibilites' | 'a_caler'

function etatDuFil(messages: Message[]): EtatFil {
  let etat: EtatFil = 'rien_a_faire'
  for (const m of messages) {
    if (m.kind === 'VISIT_REQUEST') etat = 'attente_disponibilites'
    else if (m.kind === 'AVAILABILITIES' && etat === 'attente_disponibilites') etat = 'a_caler'
    else if (m.kind === 'VISIT_CONFIRMED') etat = 'rien_a_faire'
  }
  return etat
}

const ETAT_LISIBLE: Record<EtatFil, string> = {
  rien_a_faire: 'rien à faire',
  attente_disponibilites: "en attente des disponibilités de l'acquéreur",
  a_caler: 'disponibilités reçues — À CALER',
}

/** Les disponibilités les plus récentes du fil, en texte prêt à lire. */
function dernieresDisponibilites(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.kind !== 'AVAILABILITIES') continue
    const p = m.payload as AvailabilitiesPayload | null
    if (!p || !Array.isArray(p.days)) return m.text
    try {
      return formatAvailabilities(p)
    } catch {
      return m.text
    }
  }
  return null
}

// ─── Le mode opératoire, servi au modèle ───────────────────────────────────

export const INSTRUCTIONS_AGENT = `Tu assistes un AGENT IMMOBILIER qui utilise SHOMEE, une application de
recherche immobilière par la vidéo. Tu parles à un professionnel : sois bref,
concret, et vouvoie-le.

COMMENCE TOUJOURS PAR shomee_ma_journee quand l'agent ouvre la conversation
sans demande précise (« quoi de neuf ? », « qu'est-ce qui m'attend ? »). Cet
outil donne aussi la date et l'heure de Paris : sans lui, tu ne sais pas quel
jour on est et tu ne peux pas interpréter « jeudi » ou « demain ».

RÉPONDRE AUX ACQUÉREURS
Un acquéreur qui demande une visite déclenche un fil de discussion. Il indique
des tranches grossières (matinée, déjeuner, après-midi, soir) — jamais une
heure. C'est l'AGENT qui tranche l'heure exacte, dans une de ces tranches.
Avant d'écrire quoi que ce soit dans un fil, lis-le (shomee_lire_conversation)
et propose le texte à l'agent. N'envoie jamais un message sans son accord
explicite : ce message part à un vrai client, sous son nom.

CALER UNE VISITE
shomee_confirmer_visite attend une heure LOCALE de Paris au format
AAAA-MM-JJTHH:MM. Ne convertis rien en UTC toi-même. Vérifie que l'heure
choisie tombe bien dans une tranche que l'acquéreur a cochée, et récapitule à
l'agent (jour, heure, bien, acquéreur) avant de confirmer. La confirmation
envoie un message au client et crée une invitation d'agenda : elle n'est pas
silencieuse.

CRÉER UNE ANNONCE
shomee_creer_annonce crée un BROUILLON. Aucun bien n'est publié par ce canal :
il manque toujours la vidéo, que tu ne peux pas téléverser. Récapitule les
champs compris et fais valider avant de créer, puis donne le lien pour
terminer dans le back-office.

CHIFFRES
Les outils d'analyse renvoient des valeurs déjà calculées. Cite-les telles
quelles, ne les recalcule pas, n'en déduis pas de moyennes de tête. Si un
chiffre manque, dis qu'il manque.`

// ─── Contexte partagé des fils ─────────────────────────────────────────────

/**
 * Les fils de l'agent + leurs messages + les biens et acquéreurs associés.
 * Trois requêtes fixes quel que soit le nombre de fils : la boîte de réception
 * et le point du matin ont besoin exactement des mêmes données.
 */
async function chargerFils(agentId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { agentId },
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
  })
  if (conversations.length === 0) {
    return { conversations, messages: new Map<string, Message[]>(), biens: new Map(), acquereurs: new Map() }
  }

  const [tousMessages, biens, acquereurs] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: { in: conversations.map((c) => c.id) } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.property.findMany({
      where: { id: { in: [...new Set(conversations.map((c) => c.propertyId))] } },
      select: { id: true, title: true, arrondissement: true, district: true, price: true, surface: true },
    }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(conversations.map((c) => c.buyerUserId))] } },
      select: { id: true, name: true, email: true, isGuest: true },
    }),
  ])

  const messages = new Map<string, Message[]>()
  for (const m of tousMessages) {
    const liste = messages.get(m.conversationId) ?? []
    liste.push(m)
    messages.set(m.conversationId, liste)
  }

  return {
    conversations,
    messages,
    biens: new Map(biens.map((b) => [b.id, b])),
    acquereurs: new Map(acquereurs.map((a) => [a.id, a])),
  }
}

function nomAcquereur(a: { name: string | null; isGuest: boolean } | undefined): string {
  return a?.name ?? (a?.isGuest ? 'Acquéreur invité' : 'Acquéreur')
}

// ─── Enregistrement ────────────────────────────────────────────────────────

export function outilsAgent(
  server: McpServer,
  agent: AgentConnecte,
  client: string,
  origine: string,
): void {
  // ══ 1. PILOTAGE QUOTIDIEN ════════════════════════════════════════════════

  server.registerTool(
    'shomee_ma_journee',
    {
      title: 'Le point du matin',
      description:
        "À APPELER EN PREMIER quand l'agent ouvre la conversation sans demande précise. Renvoie tout ce qui l'attend : messages non lus, demandes de visite à traiter, visites du jour et de la semaine, brouillons à finir. Donne aussi la date et l'heure de Paris — indispensable pour interpréter « jeudi » ou « demain ». Ne modifie rien.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const maintenant = new Date()
        const debutDuJour = parisLocalToUtc(`${jourParis(maintenant)}T00:00`) ?? maintenant
        const dansSeptJours = new Date(debutDuJour.getTime() + 7 * 86400_000)

        const { conversations, messages, biens, acquereurs } = await chargerFils(agent.id)

        let nonLus = 0
        const aTraiter: Array<Record<string, unknown>> = []
        for (const c of conversations) {
          const liste = messages.get(c.id) ?? []
          const curseur = c.agentLastReadAt?.getTime() ?? 0
          nonLus += liste.filter((m) => m.sender === 'BUYER' && m.createdAt.getTime() > curseur).length

          const etat = etatDuFil(liste)
          if (etat === 'rien_a_faire') continue
          const bien = biens.get(c.propertyId)
          aTraiter.push({
            conversation_id: c.id,
            etat: ETAT_LISIBLE[etat],
            acquereur: nomAcquereur(acquereurs.get(c.buyerUserId)),
            bien: bien ? `${bien.title} — ${bien.arrondissement}` : 'Bien retiré',
            disponibilites: etat === 'a_caler' ? dernieresDisponibilites(liste) : null,
            depuis: heureParis(c.lastMessageAt),
          })
        }

        const visites = await prisma.visit.findMany({
          where: {
            agentId: agent.id,
            status: 'CONFIRMED',
            scheduledAt: { gte: debutDuJour, lt: dansSeptJours },
          },
          orderBy: { scheduledAt: 'asc' },
        })
        const bienIds = [...new Set(visites.map((v) => v.propertyId))]
        const bienVisites = new Map(
          (
            await prisma.property.findMany({
              where: { id: { in: bienIds } },
              select: { id: true, title: true, arrondissement: true },
            })
          ).map((b) => [b.id, b]),
        )

        const [brouillons, sansVideo] = await Promise.all([
          prisma.property.count({
            where: { createdByAgentId: agent.id, statut: PropertyStatus.DRAFT },
          }),
          prisma.property.count({
            where: {
              createdByAgentId: agent.id,
              statut: { not: PropertyStatus.ARCHIVED },
              OR: [{ videoUrl: null }, { videoUrl: '' }],
            },
          }),
        ])

        return resultatTexte({
          ...repereParis(maintenant),
          agent: agent.name,
          agence: agent.agency.name,
          messages_non_lus: nonLus,
          demandes_a_traiter: aTraiter.length,
          detail_demandes: aTraiter,
          visites_a_venir_7_jours: visites.map((v) => {
            const b = bienVisites.get(v.propertyId)
            return {
              visite_id: v.id,
              quand: formatVisitDateParis(v.scheduledAt),
              aujourdhui: jourParis(v.scheduledAt) === jourParis(maintenant),
              duree_min: v.durationMin,
              bien: b ? `${b.title} — ${b.arrondissement}` : 'Bien retiré',
            }
          }),
          brouillons_a_finir: brouillons,
          biens_actifs_sans_video: sansVideo,
        })
      } catch (e) {
        return resultatTexte(`Point du matin impossible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  server.registerTool(
    'shomee_mes_conversations',
    {
      title: 'Boîte de réception',
      description:
        "Liste les fils de discussion de l'agent avec ses acquéreurs : dernier message, non-lus, et où en est chaque demande de visite. Utiliser `filtre` pour ne voir que ce qui demande une action. Ne marque rien comme lu, ne modifie rien.",
      inputSchema: {
        filtre: z
          .enum(['tous', 'non_lus', 'a_traiter'])
          .optional()
          .describe(
            "tous (défaut) · non_lus : fils où l'acquéreur a écrit en dernier · a_traiter : demandes de visite sans créneau calé",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ filtre }) => {
      try {
        const { conversations, messages, biens, acquereurs } = await chargerFils(agent.id)
        const lignes = conversations.map((c) => {
          const liste = messages.get(c.id) ?? []
          const dernier = liste[liste.length - 1]
          const curseur = c.agentLastReadAt?.getTime() ?? 0
          const nonLus = liste.filter((m) => m.sender === 'BUYER' && m.createdAt.getTime() > curseur).length
          const etat = etatDuFil(liste)
          const bien = biens.get(c.propertyId)
          return {
            conversation_id: c.id,
            acquereur: nomAcquereur(acquereurs.get(c.buyerUserId)),
            bien: bien ? `${bien.title} — ${bien.arrondissement} · ${euros(bien.price)}` : 'Bien retiré',
            non_lus: nonLus,
            etat: ETAT_LISIBLE[etat],
            dernier_message: dernier
              ? {
                  de: dernier.sender === 'BUYER' ? 'acquéreur' : 'vous',
                  texte: dernier.text.slice(0, 200),
                  quand: heureParis(dernier.createdAt),
                }
              : null,
            _etat: etat,
            _nonLus: nonLus,
          }
        })

        const choisi = filtre ?? 'tous'
        const filtrees = lignes.filter((l) =>
          choisi === 'non_lus' ? l._nonLus > 0 : choisi === 'a_traiter' ? l._etat !== 'rien_a_faire' : true,
        )

        return resultatTexte({
          ...repereParis(),
          filtre: choisi,
          total: filtrees.length,
          conversations: filtrees.map(({ _etat, _nonLus, ...reste }) => {
            void _etat
            void _nonLus
            return reste
          }),
        })
      } catch (e) {
        return resultatTexte(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  server.registerTool(
    'shomee_lire_conversation',
    {
      title: "Lire un fil en entier",
      description:
        "Le fil complet avec un acquéreur : tous les messages, le brief de recherche qu'il a rempli (budget, surface, critères obligatoires et rédhibitoires), ses disponibilités, les visites calées. À lire AVANT de répondre ou de caler quoi que ce soit. Ne marque pas le fil comme lu — c'est `shomee_repondre` qui le fait.",
      inputSchema: {
        conversation_id: z.string().min(1).describe('Identifiant du fil, donné par shomee_mes_conversations'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ conversation_id }) => {
      try {
        const conv = await prisma.conversation.findUnique({ where: { id: conversation_id } })
        // Cloisonnement : un fil qui n'est pas le sien n'existe pas.
        if (!conv || conv.agentId !== agent.id) return resultatTexte('Fil introuvable.', true)

        const [messages, bien, acquereur, visites] = await Promise.all([
          prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' } }),
          prisma.property.findUnique({
            where: { id: conv.propertyId },
            select: { id: true, title: true, arrondissement: true, price: true, surface: true, rooms: true },
          }),
          prisma.user.findUnique({
            where: { id: conv.buyerUserId },
            select: { name: true, email: true, isGuest: true },
          }),
          prisma.visit.findMany({ where: { conversationId: conv.id }, orderBy: { scheduledAt: 'asc' } }),
        ])

        return resultatTexte({
          ...repereParis(),
          conversation_id: conv.id,
          acquereur: {
            nom: nomAcquereur(acquereur ?? undefined),
            email: acquereur?.email ?? null,
            compte_invite: acquereur?.isGuest ?? null,
          },
          bien: bien
            ? {
                id: bien.id,
                titre: bien.title,
                secteur: bien.arrondissement,
                prix: euros(bien.price),
                surface_m2: bien.surface,
                pieces: bien.rooms,
              }
            : 'Bien retiré',
          etat: ETAT_LISIBLE[etatDuFil(messages)],
          disponibilites_indiquees: dernieresDisponibilites(messages),
          visites: visites.map((v) => ({
            visite_id: v.id,
            quand: formatVisitDateParis(v.scheduledAt),
            duree_min: v.durationMin,
            statut: v.status === 'CANCELLED' ? 'annulée' : 'confirmée',
          })),
          messages: messages.map((m) => ({
            de: m.sender === 'BUYER' ? 'acquéreur' : 'vous',
            type: m.kind,
            texte: m.text,
            quand: heureParis(m.createdAt),
            // Le brief est la vraie valeur du fil : ce que l'acquéreur cherche
            // vraiment, qualifié par lui. À citer pour argumenter la visite.
            details: m.kind === 'VISIT_REQUEST' || m.kind === 'AVAILABILITIES' ? m.payload : undefined,
          })),
        })
      } catch (e) {
        return resultatTexte(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  server.registerTool(
    'shomee_repondre',
    {
      title: 'Répondre à un acquéreur',
      description:
        "ENVOIE UN VRAI MESSAGE à un vrai client, sous le nom de l'agent, immédiatement et sans retour possible. Ne l'appeler qu'après avoir soumis le texte exact à l'agent et obtenu son accord explicite. Marque le fil comme lu au passage.",
      inputSchema: {
        conversation_id: z.string().min(1).describe('Identifiant du fil'),
        texte: z.string().min(1).max(4000).describe("Le message, tel qu'il sera lu par l'acquéreur. Vouvoiement."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ conversation_id, texte }) => {
      try {
        const conv = await prisma.conversation.findUnique({ where: { id: conversation_id } })
        if (!conv || conv.agentId !== agent.id) return resultatTexte('Fil introuvable.', true)

        const propre = texte.trim()
        if (!propre) return resultatTexte('Message vide.', true)

        const message = await prisma.message.create({
          data: { conversationId: conv.id, sender: 'AGENT', kind: 'TEXT', text: propre },
        })
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { lastMessageAt: message.createdAt, agentLastReadAt: message.createdAt },
        })

        return resultatTexte({
          envoye: true,
          quand: heureParis(message.createdAt),
          rappel: "L'acquéreur reçoit ce message dans l'application SHOMEE.",
        })
      } catch (e) {
        return resultatTexte(`Envoi impossible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  server.registerTool(
    'shomee_confirmer_visite',
    {
      title: 'Caler une visite',
      description:
        "Fixe l'heure EXACTE d'une visite, poste la confirmation dans le fil et crée l'invitation d'agenda de l'acquéreur. Action visible du client, à ne lancer qu'après récapitulatif validé par l'agent. L'heure est une heure LOCALE DE PARIS au format AAAA-MM-JJTHH:MM — ne convertis jamais en UTC toi-même. Vérifie d'abord, avec shomee_lire_conversation, que l'heure tombe dans une tranche cochée par l'acquéreur (matinée avant 12 h, déjeuner 12-14 h, après-midi 14-18 h, soir après 18 h).",
      inputSchema: {
        conversation_id: z.string().min(1).describe('Identifiant du fil'),
        date_heure_paris: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}$/, 'Format attendu : AAAA-MM-JJTHH:MM (heure de Paris)')
          .describe('Heure locale de Paris, ex. 2026-08-28T10:30'),
        duree_min: z.number().int().min(15).max(240).optional().describe('Durée en minutes, 30 par défaut'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ conversation_id, date_heure_paris, duree_min }) => {
      try {
        const conv = await prisma.conversation.findUnique({ where: { id: conversation_id } })
        if (!conv || conv.agentId !== agent.id) return resultatTexte('Fil introuvable.', true)

        const quand = parisLocalToUtc(date_heure_paris)
        if (!quand) return resultatTexte('Date illisible. Format attendu : AAAA-MM-JJTHH:MM, heure de Paris.', true)
        if (quand.getTime() < Date.now() - 60_000) {
          // Un LLM qui se trompe d'année produit sinon un rendez-vous en 2025.
          return resultatTexte(
            `Cette heure est déjà passée (${formatVisitDateParis(quand)}). Vérifiez la date — nous sommes le ${repereParis().maintenant_paris}.`,
            true,
          )
        }

        const duree = duree_min ?? 30
        const visite = await prisma.visit.create({
          data: {
            conversationId: conv.id,
            propertyId: conv.propertyId,
            buyerUserId: conv.buyerUserId,
            agentId: agent.id,
            scheduledAt: quand,
            durationMin: duree,
            icsToken: newSetupToken(),
          },
        })
        const message = await prisma.message.create({
          data: {
            conversationId: conv.id,
            sender: 'AGENT',
            kind: 'VISIT_CONFIRMED',
            text: `Visite confirmée — ${formatVisitDateParis(quand)}.`,
            payload: {
              visitId: visite.id,
              scheduledAt: quand.toISOString(),
              durationMin: duree,
              icsToken: visite.icsToken,
              status: 'CONFIRMED',
            },
          },
        })
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { lastMessageAt: message.createdAt, agentLastReadAt: message.createdAt },
        })

        return resultatTexte({
          confirmee: true,
          visite_id: visite.id,
          quand: formatVisitDateParis(quand),
          duree_min: duree,
          rappel: "L'acquéreur a reçu la confirmation et peut ajouter la visite à son agenda.",
        })
      } catch (e) {
        return resultatTexte(`Visite non calée : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  server.registerTool(
    'shomee_mes_visites',
    {
      title: 'Agenda des visites',
      description:
        "Les visites de l'agent, à venir par défaut. Donne l'heure de Paris, le bien, l'acquéreur et le statut. Ne modifie rien.",
      inputSchema: {
        jours: z.number().int().min(1).max(90).optional().describe('Fenêtre en jours à partir de maintenant, 14 par défaut'),
        inclure_passees: z.boolean().optional().describe('Inclure aussi les visites déjà passées de la période'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ jours, inclure_passees }) => {
      try {
        const maintenant = new Date()
        const fenetre = jours ?? 14
        const debut = inclure_passees
          ? new Date(maintenant.getTime() - fenetre * 86400_000)
          : (parisLocalToUtc(`${jourParis(maintenant)}T00:00`) ?? maintenant)
        const fin = new Date(maintenant.getTime() + fenetre * 86400_000)

        const visites = await prisma.visit.findMany({
          where: { agentId: agent.id, scheduledAt: { gte: debut, lt: fin } },
          orderBy: { scheduledAt: 'asc' },
        })
        const biens = new Map(
          (
            await prisma.property.findMany({
              where: { id: { in: [...new Set(visites.map((v) => v.propertyId))] } },
              select: { id: true, title: true, arrondissement: true },
            })
          ).map((b) => [b.id, b]),
        )
        const acquereurs = new Map(
          (
            await prisma.user.findMany({
              where: { id: { in: [...new Set(visites.map((v) => v.buyerUserId))] } },
              select: { id: true, name: true, isGuest: true },
            })
          ).map((a) => [a.id, a]),
        )

        return resultatTexte({
          ...repereParis(maintenant),
          fenetre_jours: fenetre,
          total: visites.length,
          visites: visites.map((v) => {
            const b = biens.get(v.propertyId)
            return {
              visite_id: v.id,
              quand: formatVisitDateParis(v.scheduledAt),
              duree_min: v.durationMin,
              statut: v.status === 'CANCELLED' ? 'annulée' : 'confirmée',
              bien: b ? `${b.title} — ${b.arrondissement}` : 'Bien retiré',
              acquereur: nomAcquereur(acquereurs.get(v.buyerUserId)),
              conversation_id: v.conversationId,
            }
          }),
        })
      } catch (e) {
        return resultatTexte(`Agenda indisponible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  server.registerTool(
    'shomee_annuler_visite',
    {
      title: 'Annuler une visite',
      description:
        "ANNULE une visite déjà confirmée : l'acquéreur en est informé dans le fil et son invitation d'agenda passe en annulée. Irréversible — recaler demande une nouvelle confirmation. Exiger l'accord explicite de l'agent, et récapituler la visite concernée avant.",
      inputSchema: { visite_id: z.string().min(1).describe('Identifiant de la visite, donné par shomee_mes_visites') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ visite_id }) => {
      try {
        const visite = await prisma.visit.findUnique({ where: { id: visite_id } })
        if (!visite || visite.agentId !== agent.id) return resultatTexte('Visite introuvable.', true)
        if (visite.status === 'CANCELLED') return resultatTexte({ annulee: true, deja: true })

        await prisma.visit.update({ where: { id: visite.id }, data: { status: 'CANCELLED' } })
        const message = await prisma.message.create({
          data: {
            conversationId: visite.conversationId,
            sender: 'AGENT',
            kind: 'SYSTEM',
            text: `La visite du ${formatVisitDateParis(visite.scheduledAt)} a été annulée par l'agence.`,
            payload: { visitId: visite.id, status: 'CANCELLED' },
          },
        })
        await prisma.conversation.update({
          where: { id: visite.conversationId },
          data: { lastMessageAt: message.createdAt },
        })

        return resultatTexte({
          annulee: true,
          quand: formatVisitDateParis(visite.scheduledAt),
          rappel: "L'acquéreur a été prévenu dans le fil.",
        })
      } catch (e) {
        return resultatTexte(`Annulation impossible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  // ══ 2. SAISIE DES MANDATS ════════════════════════════════════════════════

  server.registerTool(
    'shomee_creer_annonce',
    {
      title: 'Créer une annonce',
      description:
        "Crée une annonce en BROUILLON à partir de ce que l'agent décrit (dictée, mandat, fiche existante). Seule l'adresse est obligatoire : tout champ inconnu doit rester vide plutôt qu'être inventé — une valeur devinée est un mensonge commercial. Récapituler les champs compris et faire valider AVANT d'appeler. Le bien n'est pas publié : la vidéo, indispensable sur SHOMEE, se téléverse dans le back-office, dont le lien est renvoyé ici.",
      inputSchema: {
        adresse: z.string().min(1).describe('Adresse complète, avec le code postal si connu. Seul champ obligatoire.'),
        prix: z.number().int().nonnegative().optional().describe('Prix de vente en euros, hors honoraires'),
        prix_fai: z.number().int().nonnegative().optional().describe('Prix honoraires inclus. Prioritaire sur `prix` pour l’affichage.'),
        surface: z.number().nonnegative().optional().describe('Surface habitable en m² (Carrez)'),
        nb_pieces: z.number().int().nonnegative().optional(),
        nb_chambres: z.number().int().nonnegative().optional(),
        type_bien: z.string().optional().describe('Appartement, Maison, Loft, Atelier, Duplex…'),
        quartier: z.string().optional().describe('Quartier vécu (Aligre, Chartrons, Batignolles…)'),
        description: z.string().optional().describe("Texte d'annonce. Reprendre les mots de l'agent, ne pas broder."),
        etage: z.number().int().optional(),
        nb_etages_total: z.number().int().positive().optional(),
        annee_construction: z.number().int().optional(),
        caracteristiques: z
          .array(z.string())
          .optional()
          .describe('Équipements factuels : ascenseur, cave, parking, balcon, gardien…'),
        specificites: z
          .array(z.string())
          .optional()
          .describe('Atouts et ambiance : lumineux, calme, traversant, vue dégagée, charme…'),
        composition: z
          .array(z.object({ label: z.string(), surface: z.number() }))
          .optional()
          .describe('Pièce par pièce : [{label:"Séjour", surface:32}]'),
        dpe: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']).optional(),
        ges: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']).optional(),
        charges_copro: z.number().int().nonnegative().optional().describe('Charges de copropriété mensuelles, en euros'),
        taxe_fonciere: z.number().int().nonnegative().optional().describe('Taxe foncière annuelle, en euros'),
        mandat_type: z.enum(['SIMPLE', 'EXCLUSIF']).optional(),
        ref_interne: z.string().optional().describe("Référence interne de l'agence"),
        avant_premiere: z.boolean().optional().describe('Diffusé en avant-première avant publication large'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (entree) => {
      try {
        const quota = await verifierQuota(agent)
        if (!quota.ok) {
          return resultatTexte(
            `Quota atteint : ${quota.current} biens actifs sur ${quota.max} autorisés pour ${agent.agency.name}. Archivez un bien ou passez en Pro.`,
            true,
          )
        }

        // Traçabilité : plutôt que de demander au modèle d'où vient chaque
        // champ (15 questions de plus, et autant d'occasions d'inventer), on
        // marque en bloc la provenance réelle — la dictée à un assistant.
        const marqueur = `Dicté via ${client === 'chatgpt' ? 'ChatGPT' : client === 'claude' ? 'Claude' : 'un assistant'}`
        const source = (v: unknown) => (v === undefined || v === null ? undefined : marqueur)

        const brut: ImportPayload = {
          ...entree,
          location_source: marqueur,
          prix_source: source(entree.prix ?? entree.prix_fai),
          surface_source: source(entree.surface),
          nb_pieces_source: source(entree.nb_pieces),
          nb_chambres_source: source(entree.nb_chambres),
          type_bien_source: source(entree.type_bien),
          quartier_source: source(entree.quartier),
          description_source: source(entree.description),
          etage_source: source(entree.etage),
          annee_construction_source: source(entree.annee_construction),
          composition_source: source(entree.composition),
          mandat_type_source: source(entree.mandat_type),
          ref_interne_source: source(entree.ref_interne),
          dpe_source: source(entree.dpe),
          ges_source: source(entree.ges),
          charges_copro_source: source(entree.charges_copro),
          taxe_fonciere_source: source(entree.taxe_fonciere),
        }

        // Ceinture et bretelles : le même schéma que la route HTTP.
        const verifie = ImportLLMSchema.safeParse(brut)
        if (!verifie.success) {
          return resultatTexte(
            `Annonce refusée : ${verifie.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`).join(' ; ')}`,
            true,
          )
        }

        const bien = await creerBienDepuisLLM(agent, verifie.data)
        return resultatTexte({
          cree: true,
          bien_id: bien.id,
          completude: `${Math.round(bien.completionRate * 100)} % (${bien.fieldsFilled}/${bien.fieldsTotal} champs clés)`,
          statut: 'brouillon',
          prochaine_etape: `Ouvrez ${origine}/agent/biens/${bien.id}/editer pour ajouter la vidéo et publier.`,
        })
      } catch (e) {
        return resultatTexte(`Création impossible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  server.registerTool(
    'shomee_lister_biens',
    {
      title: 'Mes biens',
      description:
        "Les biens de l'agent : titre, secteur, prix, statut (brouillon, publié, dépublié, archivé), complétude de la fiche et présence de la vidéo. Sert à retrouver un `bien_id` avant d'analyser ses performances. Ne modifie rien.",
      inputSchema: {
        statut: z
          .enum(['tous', 'brouillon', 'publie', 'depublie', 'archive'])
          .optional()
          .describe('tous (défaut, hors archivés) ou un statut précis'),
        recherche: z.string().optional().describe('Filtre sur le titre, l’adresse ou le quartier'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ statut, recherche }) => {
      try {
        const parStatut: Record<string, PropertyStatus> = {
          brouillon: PropertyStatus.DRAFT,
          publie: PropertyStatus.PUBLISHED,
          depublie: PropertyStatus.UNPUBLISHED,
          archive: PropertyStatus.ARCHIVED,
        }
        const choisi = statut ?? 'tous'
        const biens = await prisma.property.findMany({
          where: {
            createdByAgentId: agent.id,
            ...(choisi === 'tous'
              ? { statut: { not: PropertyStatus.ARCHIVED } }
              : { statut: parStatut[choisi] }),
            ...(recherche
              ? {
                  OR: [
                    { title: { contains: recherche, mode: 'insensitive' as const } },
                    { location: { contains: recherche, mode: 'insensitive' as const } },
                    { district: { contains: recherche, mode: 'insensitive' as const } },
                    { arrondissement: { contains: recherche, mode: 'insensitive' as const } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
          select: {
            id: true,
            title: true,
            arrondissement: true,
            district: true,
            price: true,
            surface: true,
            rooms: true,
            statut: true,
            videoUrl: true,
            completionRate: true,
            updatedAt: true,
          },
        })

        const lisible: Record<string, string> = {
          DRAFT: 'brouillon',
          PUBLISHED: 'publié',
          UNPUBLISHED: 'dépublié',
          ARCHIVED: 'archivé',
        }

        return resultatTexte({
          ...repereParis(),
          filtre: choisi,
          total: biens.length,
          biens: biens.map((b) => ({
            bien_id: b.id,
            titre: b.title,
            secteur: b.arrondissement || b.district,
            prix: euros(b.price),
            surface_m2: b.surface,
            pieces: b.rooms,
            statut: lisible[b.statut] ?? b.statut,
            video: b.videoUrl ? 'oui' : 'MANQUANTE',
            fiche_complete_a: `${Math.round((b.completionRate ?? 0) * 100)} %`,
            modifie_le: heureParis(b.updatedAt),
          })),
        })
      } catch (e) {
        return resultatTexte(`Liste indisponible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  // ══ 3. ANALYSE DES MANDATS ═══════════════════════════════════════════════

  server.registerTool(
    'shomee_performance_bien',
    {
      title: "Performance d'un bien",
      description:
        "Comment un bien se comporte dans le feed : vues, temps de visionnage, ouvertures de la fiche, favoris, passages rapides, partages, conversations et visites — avec la médiane du portefeuille de l'agent comme point de comparaison, et la liste de ce qui manque sur la fiche. Chiffres calculés en base, à citer tels quels sans les recalculer. Ne modifie rien.",
      inputSchema: {
        bien_id: z.string().min(1).describe('Identifiant du bien, donné par shomee_lister_biens'),
        jours: z.number().int().min(1).max(365).optional().describe('Période observée, 30 jours par défaut'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ bien_id, jours }) => {
      try {
        const bien = await prisma.property.findUnique({ where: { id: bien_id } })
        // Cloisonnement : le bien d'un confrère n'existe pas.
        if (!bien || bien.createdByAgentId !== agent.id) return resultatTexte('Bien introuvable.', true)

        const fenetre = jours ?? 30
        const depuis = new Date(Date.now() - fenetre * 86400_000)

        const mesBiens = await prisma.property.findMany({
          where: { createdByAgentId: agent.id, statut: { not: PropertyStatus.ARCHIVED } },
          select: { id: true },
        })
        const [parBien, spectateurs, durees, partagesLien, conversations, visites] = await Promise.all([
          evenementsParBien(mesBiens.map((b) => b.id), depuis),
          prisma.interactionEvent.groupBy({
            by: ['deviceId'],
            where: { propertyId: bien_id, type: 'video_start', createdAt: { gte: depuis } },
          }),
          prisma.interactionEvent.groupBy({
            by: ['type'],
            where: { propertyId: bien_id, type: { in: ['dwell', 'detail_dwell'] }, createdAt: { gte: depuis } },
            _avg: { valueMs: true },
          }),
          prisma.shareView.count({ where: { propertyId: bien_id, isBot: false, createdAt: { gte: depuis } } }),
          prisma.conversation.count({ where: { propertyId: bien_id } }),
          prisma.visit.count({ where: { propertyId: bien_id, status: 'CONFIRMED' } }),
        ])

        const c = parBien.get(bien_id)
        const vues = compte(c, 'video_start')
        const fiches = compte(c, 'detail_open')
        const favoris = Math.max(0, compte(c, 'fav') - compte(c, 'unfav'))
        const secondes = (t: string) => {
          const l = durees.find((d) => d.type === t)?._avg.valueMs
          return typeof l === 'number' ? Math.round(l / 1000) : null
        }

        // Le repère : la médiane des AUTRES biens actifs, calculée ici pour que
        // « deux fois moins que vos autres biens » soit un fait, pas une
        // impression du modèle.
        const autres = mesBiens.filter((b) => b.id !== bien_id).map((b) => parBien.get(b.id))
        const medianeVues = mediane(autres.map((x) => compte(x, 'video_start')))
        const medianeTaux = mediane(
          autres.map((x) => {
            const v = compte(x, 'video_start')
            return v > 0 ? Math.round((compte(x, 'detail_open') / v) * 100) : 0
          }),
        )

        return resultatTexte({
          ...repereParis(),
          bien: `${bien.title} — ${bien.arrondissement} · ${euros(bien.price)} · ${bien.surface} m²`,
          statut: bien.statut,
          periode_jours: fenetre,
          audience: {
            vues: vues,
            spectateurs_uniques: spectateurs.length,
            temps_moyen_sur_la_video_s: secondes('dwell'),
            passages_rapides: compte(c, 'skip_fast'),
            taux_de_passage_rapide: pourcent(compte(c, 'skip_fast'), vues),
          },
          interet: {
            fiches_ouvertes: fiches,
            taux_ouverture_fiche: pourcent(fiches, vues),
            temps_moyen_sur_la_fiche_s: secondes('detail_dwell'),
            favoris_nets: favoris,
            taux_de_favori: pourcent(favoris, vues),
            partages_dans_app: compte(c, 'share'),
            liens_partages_ouverts: partagesLien,
          },
          transformation: {
            conversations_ouvertes: conversations,
            visites_confirmees: visites,
          },
          repere_portefeuille: {
            vues_medianes_de_vos_autres_biens: medianeVues,
            taux_ouverture_median_de_vos_autres_biens: `${medianeTaux} %`,
          },
          manque_sur_la_fiche: manquesFiche(bien),
        })
      } catch (e) {
        return resultatTexte(`Analyse impossible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  server.registerTool(
    'shomee_tableau_de_bord',
    {
      title: 'Tableau de bord des mandats',
      description:
        "Vue d'ensemble du portefeuille de l'agent sur une période : vues, ouvertures de fiche, favoris, conversations et visites bien par bien, classés du plus vu au moins vu, plus les totaux et les biens qui n'ont eu aucune vue. Chiffres calculés en base, à citer tels quels. Ne modifie rien.",
      inputSchema: {
        jours: z.number().int().min(1).max(365).optional().describe('Période observée, 30 jours par défaut'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ jours }) => {
      try {
        const fenetre = jours ?? 30
        const depuis = new Date(Date.now() - fenetre * 86400_000)

        const biens = await prisma.property.findMany({
          where: { createdByAgentId: agent.id, statut: { not: PropertyStatus.ARCHIVED } },
          select: { id: true, title: true, arrondissement: true, price: true, statut: true, videoUrl: true },
        })
        if (biens.length === 0) {
          return resultatTexte({ ...repereParis(), message: 'Aucun bien actif sur ce compte.' })
        }
        const ids = biens.map((b) => b.id)

        const [parBien, conversations, visites] = await Promise.all([
          evenementsParBien(ids, depuis),
          prisma.conversation.groupBy({ by: ['propertyId'], where: { agentId: agent.id }, _count: { _all: true } }),
          prisma.visit.groupBy({
            by: ['propertyId'],
            where: { agentId: agent.id, status: 'CONFIRMED', scheduledAt: { gte: depuis } },
            _count: { _all: true },
          }),
        ])
        const convParBien = new Map(conversations.map((l) => [l.propertyId, l._count._all]))
        const visParBien = new Map(visites.map((l) => [l.propertyId, l._count._all]))

        const lignes = biens
          .map((b) => {
            const c = parBien.get(b.id)
            const vues = compte(c, 'video_start')
            const fiches = compte(c, 'detail_open')
            return {
              bien_id: b.id,
              bien: `${b.title} — ${b.arrondissement}`,
              prix: euros(b.price),
              statut: b.statut,
              video: b.videoUrl ? 'oui' : 'MANQUANTE',
              vues,
              fiches_ouvertes: fiches,
              taux_ouverture_fiche: pourcent(fiches, vues),
              favoris_nets: Math.max(0, compte(c, 'fav') - compte(c, 'unfav')),
              conversations: convParBien.get(b.id) ?? 0,
              visites: visParBien.get(b.id) ?? 0,
            }
          })
          .sort((a, b) => b.vues - a.vues)

        const somme = (cle: 'vues' | 'fiches_ouvertes' | 'favoris_nets' | 'conversations' | 'visites') =>
          lignes.reduce((t, l) => t + l[cle], 0)

        return resultatTexte({
          ...repereParis(),
          periode_jours: fenetre,
          biens_actifs: lignes.length,
          totaux: {
            vues: somme('vues'),
            fiches_ouvertes: somme('fiches_ouvertes'),
            taux_ouverture_fiche: pourcent(somme('fiches_ouvertes'), somme('vues')),
            favoris_nets: somme('favoris_nets'),
            conversations: somme('conversations'),
            visites_confirmees: somme('visites'),
          },
          mediane_vues_par_bien: mediane(lignes.map((l) => l.vues)),
          biens_sans_aucune_vue: lignes.filter((l) => l.vues === 0).map((l) => l.bien),
          classement: lignes,
        })
      } catch (e) {
        return resultatTexte(`Tableau de bord indisponible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )
}

// ─── Calculs d'audience ────────────────────────────────────────────────────

type Compteurs = Record<string, number>

function compte(c: Compteurs | undefined, type: string): number {
  return c?.[type] ?? 0
}

/** Médiane entière — 0 si l'échantillon est vide. */
function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0
  const tri = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(tri.length / 2)
  return tri.length % 2 === 1 ? tri[milieu] : Math.round((tri[milieu - 1] + tri[milieu]) / 2)
}

/**
 * Une seule agrégation SQL pour tout le portefeuille. Le modèle ne reçoit que
 * des totaux : lui faire additionner des lignes brutes, c'est obtenir deux
 * réponses différentes à la même question deux jours de suite.
 */
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

/**
 * Ce qui manque sur la fiche. C'est la moitié utile de l'analyse : un bien qui
 * ne décolle pas a plus souvent une fiche incomplète qu'un problème de prix.
 */
function manquesFiche(bien: {
  videoUrl: string | null
  description: string
  price: number
  surface: number
  rooms: number
  gallery: string[]
  floor: number | null
  yearBuilt: number | null
  monthlyCharges: number | null
  propertyTax: number | null
  composition: unknown
}): string[] {
  const manques: string[] = []
  if (!bien.videoUrl) manques.push('la vidéo — sans elle le bien ne peut pas apparaître dans le feed')
  if (bien.description.trim().length < 200) manques.push('une description étoffée (moins de 200 caractères)')
  if (bien.price <= 0) manques.push('le prix')
  if (bien.surface <= 0) manques.push('la surface')
  if (bien.rooms <= 0) manques.push('le nombre de pièces')
  if (!bien.gallery || bien.gallery.length === 0) manques.push('les photos')
  if (bien.floor === null) manques.push("l'étage")
  if (bien.yearBuilt === null) manques.push("l'année de construction")
  if (bien.monthlyCharges === null) manques.push('les charges de copropriété')
  if (bien.propertyTax === null) manques.push('la taxe foncière')
  if (!bien.composition) manques.push('la composition pièce par pièce')
  return manques
}
