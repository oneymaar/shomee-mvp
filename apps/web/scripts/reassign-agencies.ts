#!/usr/bin/env npx tsx
/**
 * Ré-assigne l'agence de chaque bien en fonction de sa localisation.
 *
 * Problème : les agences sont aujourd'hui attribuées aléatoirement. Une agence
 * du 16e peut apparaître sur un bien du Sentier (2e). Ce script applique le
 * mapping localisation → agence défini dans le sprint.
 *
 * Source de vérité : `property.location` (quartier vécu). Conformément à la
 * priorité de résolution du projet (quartier vécu > QA administratif > station),
 * on lit d'abord `location`. Si `location` est un libellé non géographique
 * (ex. "Maison de retraite", "Vieille Ville"), on retombe sur `title`.
 *
 * Stratégie :
 *   1. Normaliser le texte (minuscules, sans accents).
 *   2. Résoudre une ZONE : numéro d'arrondissement Paris (1..20) OU commune.
 *      - Communes (Neuilly, Boulogne, Saint-Cloud, Vincennes, …) en priorité.
 *      - Sinon, table quartier → arrondissement.
 *   3. ZONE → agence via le mapping du sprint, avec :
 *      - règle de prix pour Paris 7 (Varenne si >= 2M€, sinon Barnes),
 *      - alternance pour 16e (Daniel Féau / Frédélion) et 11/12e (Century 21 /
 *        Orpi Nation),
 *      - sous-règle Batignolles dans le 17e (Laforêt Batignolles).
 *   4. Arrondissements parisiens SANS agence locale (1,5,9,13,18,19) et biens
 *      non localisables → pool premium Kretz / Junot (alternance).
 *   5. Mettre à jour `agencyId` (+ `createdByAgentId` vers l'agent de la nouvelle
 *      agence, chaque agence n'ayant qu'un agent) et logguer chaque changement.
 *
 * Usage :
 *   npx tsx scripts/reassign-agencies.ts          # applique
 *   npx tsx scripts/reassign-agencies.ts --dry     # simulation (aucune écriture)
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const DRY_RUN = process.argv.includes('--dry')

// ─── Normalisation ───────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/[^a-z0-9]+/g, ' ')      // ponctuation/apostrophes → espace
    .trim()
}

// ─── Tables de résolution ────────────────────────────────────────────────────

// Communes de banlieue (priorité haute). Clés déjà normalisées.
// `null` ⇒ pas d'agence locale ⇒ pool premium.
const SUBURBS: ReadonlyArray<[string, string | null]> = [
  ['neuilly', 'Guy Hoquet Neuilly'],
  ['levallois', 'Guy Hoquet Neuilly'],
  ['anatole france', 'Guy Hoquet Neuilly'], // métro Anatole France = Levallois
  ['billancourt', 'IAD Boulogne-Issy'],
  ['boulogne', 'IAD Boulogne-Issy'],
  ['seguin', 'IAD Boulogne-Issy'], // Île Seguin = Boulogne-Billancourt
  ['issy', 'IAD Boulogne-Issy'],
  ['moulineaux', 'IAD Boulogne-Issy'],
  ['meudon', 'IAD Boulogne-Issy'], // non mappé → voisin SO de Boulogne/Issy
  ['clamart', 'IAD Boulogne-Issy'], // non mappé → voisin SO
  ['saint cloud', 'Orpi Saint-Cloud Sèvres'],
  ['sevres', 'Orpi Saint-Cloud Sèvres'],
  ['versailles', 'Orpi Saint-Cloud Sèvres'], // non mappé → ouest
  ['rueil', 'Orpi Saint-Cloud Sèvres'], // non mappé → ouest
  ['vincennes', 'Century 21 Bastille'], // non mappé → est, adjacent 12e/Nation
  ['villejuif', null], // non mappé → pool premium
]

// Quartiers parisiens → arrondissement. Clés normalisées, plus spécifiques
// d'abord (premier `includes` qui matche gagne).
const PARIS_HOODS: ReadonlyArray<[string, number]> = [
  // 7e
  ['sevres babylon', 7],
  ['champs de mars', 7],
  ['ecole militaire', 7],
  ['les invalides', 7],
  ['invalides', 7],
  // 1er
  ['place vendome', 1],
  ['chatelet', 1],
  ['les halles', 1],
  ['ile de la cite', 1],
  // 4e
  ['ile saint louis', 4],
  ['saint paul', 4],
  ['marais archives', 4],
  // 3e
  ['marais turenne', 3],
  ['le marais', 3],
  ['marais', 3],
  ['temple', 3],
  // 2e
  ['montorgueil', 2],
  ['bonne nouvelle', 2],
  ['sentier', 2],
  ['passage des panoramas', 2],
  ['rue de la paix', 2],
  // 5e
  ['quartier latin', 5],
  ['pantheon', 5],
  ['contrescarpe', 5],
  // 6e
  ['saint germain des pres', 6],
  ['saint germain', 6],
  ['odeon', 6],
  ['luxembourg', 6],
  // 8e
  ['champs elysees', 8],
  ['faubourg saint honore', 8],
  ['franklin roosevelt', 8],
  ['concorde', 8],
  // 17e vs 8e (Monceau)
  ['plaine monceau', 17],
  ['parc monceau', 8],
  ['monceau', 8],
  // 9e
  ['opera garnier', 9],
  ['opera', 9],
  ['pigalle', 9],
  // 10e
  ['canal saint martin', 10],
  // 11e
  ['oberkampf', 11],
  ['parmentier', 11],
  ['cirque d hiver', 11],
  ['republique', 11],
  ['bastille', 11],
  // 20e
  ['belleville couronnes', 20],
  ['belleville', 20],
  ['gambetta', 20],
  ['menilmontant', 20],
  ['pere lachaise', 20],
  // 12e
  ['nation', 12],
  ['bercy', 12],
  ['daumesnil', 12],
  ['bel air', 12],
  ['gare de lyon', 12],
  ['promenade plantee', 12],
  ['ledru rollin', 12],
  // 13e
  ['buttes aux cailles', 13],
  ['tolbiac', 13],
  ['place d italie', 13],
  // 14e
  ['square de montsouris', 14],
  ['montsouris', 14],
  ['montparnasse', 14],
  ['alesia', 14],
  ['denfert rochereau', 14],
  // 15e
  ['bir hakeim', 15],
  ['saint charles', 15],
  ['convention', 15],
  ['balard', 15],
  // 16e
  ['passy', 16],
  ['auteuil', 16],
  ['avenue foch', 16],
  ['ranelagh', 16],
  ['trocadero', 16],
  // 17e
  ['ternes', 17],
  ['batignolles', 17],
  // 18e
  ['montmartre', 18],
  ['abbesses', 18],
  // 19e
  ['bassin de la villette', 19],
]

// ─── Alternance déterministe ─────────────────────────────────────────────────

const counters: Record<string, number> = {}
function alternate(key: string, a: string, b: string): string {
  const i = counters[key] ?? 0
  counters[key] = i + 1
  return i % 2 === 0 ? a : b
}

// ─── Arrondissement → agence ─────────────────────────────────────────────────

function arrToAgency(arr: number, normText: string, price: number): string {
  switch (arr) {
    case 7:
      return price >= 2_000_000 ? 'Varenne & Associés' : 'Barnes Tour Eiffel'
    case 15:
      return 'Barnes Tour Eiffel'
    case 8:
      return 'Laforêt Monceau'
    case 17:
      return normText.includes('batignolles') ? 'Laforêt Batignolles' : 'Laforêt Monceau'
    case 3:
    case 4:
      return 'Engel & Völkers Marais'
    case 2:
    case 10:
      return "L'Agence des Enfants Rouges"
    case 16:
      return alternate('arr16', 'Daniel Féau Passy', 'Frédélion Trocadéro')
    case 11:
    case 12:
      return alternate('arr1112', 'Century 21 Bastille', 'Orpi Nation')
    case 20:
      return 'Orpi Nation'
    case 6:
    case 14:
      return 'Morriss Montparnasse'
    default:
      // 1, 5, 9, 13, 18, 19 → pas d'agence locale → pool premium.
      return alternate('premium', 'Kretz Real Estate', 'Junot Immobilier')
  }
}

// ─── Résolution principale ───────────────────────────────────────────────────

type Resolution = { agency: string; zone: string }

function resolveZone(text: string): { kind: 'arr'; arr: number } | { kind: 'suburb'; agency: string | null } | null {
  // Garde-fous avant la détection des communes :
  if (text.includes('bois de boulogne')) return { kind: 'arr', arr: 16 } // parc du 16e, pas la commune
  if (text.includes('babylon')) return { kind: 'arr', arr: 7 } // Sèvres-Babylone = métro 6e/7e

  // "Paris 16e", "Paris 7ème" → arrondissement explicite.
  const m = text.match(/paris (\d{1,2})/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 20) return { kind: 'arr', arr: n }
  }

  // Communes de banlieue.
  for (const [kw, agency] of SUBURBS) {
    if (text.includes(kw)) return { kind: 'suburb', agency }
  }

  // Quartiers parisiens.
  for (const [kw, arr] of PARIS_HOODS) {
    if (text.includes(kw)) return { kind: 'arr', arr }
  }

  return null
}

function resolve(location: string, title: string, price: number): Resolution {
  const normLoc = normalize(location)
  // 1. On tente la localisation (quartier vécu) en priorité.
  let z = resolveZone(normLoc)
  let usedText = normLoc
  // 2. Si la localisation n'est pas géographique, on retombe sur le titre.
  if (!z) {
    const normTitle = normalize(title)
    z = resolveZone(normTitle)
    usedText = normTitle
  }

  if (!z) {
    // 3. Non localisable → pool premium.
    return { agency: alternate('premium', 'Kretz Real Estate', 'Junot Immobilier'), zone: 'non localisé' }
  }
  if (z.kind === 'suburb') {
    if (z.agency === null) {
      return { agency: alternate('premium', 'Kretz Real Estate', 'Junot Immobilier'), zone: 'banlieue non mappée' }
    }
    return { agency: z.agency, zone: 'banlieue' }
  }
  return { agency: arrToAgency(z.arr, usedText, price), zone: `Paris ${z.arr}` }
}

// ─── Exécution ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏷️  Ré-assignation des agences${DRY_RUN ? ' (DRY RUN — aucune écriture)' : ''}\n`)

  // Agences + leur agent unique.
  const agencies = await prisma.agency.findMany({
    include: { agents: { select: { id: true }, take: 1 } },
  })
  const byName = new Map(agencies.map((a) => [a.name, a]))

  const props = await prisma.property.findMany({
    select: { id: true, title: true, location: true, price: true, agencyId: true, createdByAgentId: true },
    orderBy: { id: 'asc' }, // ordre stable ⇒ alternance reproductible
  })

  let changed = 0
  const dist: Record<string, number> = {}

  for (const p of props) {
    const { agency: targetName, zone } = resolve(p.location, p.title, p.price)
    const target = byName.get(targetName)
    if (!target) throw new Error(`Agence introuvable en DB : "${targetName}"`)
    const targetAgentId = target.agents[0]?.id
    if (!targetAgentId) throw new Error(`Aucun agent pour l'agence "${targetName}"`)

    dist[targetName] = (dist[targetName] ?? 0) + 1

    if (p.agencyId === target.id) continue
    changed++

    const oldName = agencies.find((a) => a.id === p.agencyId)?.name ?? '?'
    console.log(
      `• ${p.title.slice(0, 42).padEnd(42)} [${p.location.slice(0, 22).padEnd(22)}] ` +
        `${zone.padEnd(18)} ${oldName}  →  ${targetName}`,
    )

    if (!DRY_RUN) {
      await prisma.property.update({
        where: { id: p.id },
        data: { agencyId: target.id, createdByAgentId: targetAgentId },
      })
    }
  }

  console.log(`\n📊 Distribution finale (${props.length} biens) :`)
  for (const [name, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}  ${name}`)
  }
  console.log(`\n✅ ${changed} bien(s) ré-assigné(s)${DRY_RUN ? ' (simulation)' : ''}.\n`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
