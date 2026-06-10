import { readFileSync } from 'node:fs'
const env = readFileSync('.env', 'utf8')
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const p = new PrismaClient({ adapter })

const composition = [
  { label: 'Entrée',       surface: 2.37 },
  { label: 'Salon',        surface: 17.2 },
  { label: 'Cuisine',      surface: 8.6 },
  { label: 'Chambre 1',    surface: 11.33 },
  { label: 'Chambre 2',    surface: 11.4 },
  { label: 'Dégagement',   surface: 5.7 },
  { label: 'Salle d\'eau', surface: 3.93 },
  { label: 'WC',           surface: 1.37 },
  { label: 'Placard 1',    surface: 0.7 },
  { label: 'Placard 2',    surface: 0.4 },
]

const description = "Au 2ème étage d'un immeuble construit entre 1948 et 1974, bel appartement de 3 pièces de 63 m² (Loi Carrez). Il se compose d'une entrée, d'un séjour de 17 m² ouvrant sur balcon, d'une cuisine séparée, de deux chambres de 11 m² chacune, d'une salle d'eau et d'un WC indépendant. Deux balcons côté avenue et côté cour. Cave en sous-sol. Chauffage collectif gaz, double vitrage sur les principales ouvertures. Quartier Bel-Air, à proximité immédiate de la coulée verte René Dumont."

const created = await p.property.create({
  data: {
    arrondissement:       'Paris 75012',
    subtitle:             '3 pièces · 63 m² · Bel-Air',
    agentName:            "Kretz · Triangle d'or",
    agentAvatar:          '/agencies/Logo Kretz.png',

    title:                "3 pièces 63m² avec 2 balcons — Bel-Air",
    price:                510000,
    pricePerSqm:          Math.round(510000 / 63),
    surface:              63,
    rooms:                3,
    bedrooms:             2,
    location:             '116 Av. du Général Michel Bizot, 75012 Paris',
    district:             'Paris 12e — Bel-Air',
    description,
    tags:                 [],
    features:             ['Balcon', 'Cave', 'Double vitrage'],
    dpe:                  'F',
    ges:                  'F',

    floor:                2,
    orientation:          'Est-Ouest',
    exteriorType:         'Balcon',
    heatingType:          'Collectif gaz',
    hotWaterType:         'Combiné chauffage',
    yearBuilt:            1960,
    monthlyCharges:       720,
    propertyTax:          1200,

    composition,

    videoUrl:             'https://res.cloudinary.com/dcysksoo3/video/upload/v1780330780/shomee/videos/w6zdvcqhkpyboa6bysdw.mov',
    imageUrlFallback:     'https://images.unsplash.com/photo-1615874959474-d609969a20ed?w=800&h=1400&fit=crop&q=80',
    gallery:              [],

    hasBalcony:           true,
    hasCellar:            true,
    hasElevator:          false,

    mandatType:           'SIMPLE',
    statut:               'DRAFT',
    completionRate:       0,

    agencyId:             'cmppap3mr0000co285c079bkt',
    createdByAgentId:     'cmppap3o70001co283ouvwrh9',
  },
  select: { id: true, title: true, videoUrl: true, rooms: true, bedrooms: true },
})
console.log(JSON.stringify(created, null, 2))
await p.$disconnect()
