import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'
import type { Property } from '@/lib/types'
import EditBienClient from './EditBienClient'

export const dynamic = 'force-dynamic'

const MOCK_PROPERTY: Property = {
  id: 'draft-001',
  arrondissement: 'PARIS 8e',
  subtitle: 'Haussmannien Faubourg Saint-Honoré',
  agentName: 'Kretz · Triangle d\'or',
  agentAvatar: '/agencies/Logo Kretz.png',

  title: 'Haussmannien 140m² — Faubourg Saint-Honoré',
  price: 3_500_000,
  pricePerSqm: 25_000,
  surface: 140,
  rooms: 5,
  bedrooms: 3,
  location: '12 rue du Faubourg Saint-Honoré, Paris 75008',
  district: 'Faubourg Saint-Honoré — Madeleine',
  description:
    "Haussmannien classique au 4ᵉ étage d'un immeuble pierre de taille rue du Faubourg Saint-Honoré. Réception double traversante avec balcon filant côté rue, parquet point de Hongrie, moulures et cheminées en marbre d'origine. Trois chambres côté cour silencieuse, dressing, cuisine équipée. Cave et accès direct ascenseur.",
  tags: [
    'Séjour orienté sud',
    'Pas de vis-à-vis',
    'Parquet ancien',
    'Hauteur sous plafond > 3m',
    'Cuisine ouverte',
    'Chambres sur cour',
    'Double vitrage',
    'Luminosité excellente',
    'Immeuble haussmannien',
    'Cave',
  ],
  features: ['Ascenseur', 'Cave', 'Gardien', 'Balcon', 'Parquet', 'Double vitrage', 'Cheminée'],
  dpe: 'B',
  ges: 'C',
  floor: 4,
  totalFloors: 6,
  orientation: 'Est-Ouest',
  exteriorType: 'Balcon filant 8m²',
  heatingType: 'Collectif (gaz)',
  hotWaterType: 'Collectif (gaz)',
  yearBuilt: 1880,
  lotCount: 10,
  proceduresEnCours: false,
  monthlyCharges: 720,
  propertyTax: 5_400,
  composition: [
    { label: 'Double salon traversant', surface: 48 },
    { label: 'Cuisine équipée', surface: 14 },
    { label: 'Chambre parentale', surface: 22 },
    { label: 'Chambre 2', surface: 16 },
    { label: 'Chambre 3', surface: 14 },
    { label: 'Salle de bain', surface: 10 },
    { label: 'Salle d\'eau', surface: 6 },
    { label: 'Dressing', surface: 5 },
    { label: 'Entrée / dégagement', surface: 5 },
  ],
  irisZone: 'Faubourg-du-Roule — Madeleine',
  irisDescription:
    'Cœur du Triangle d\'or, entre l\'Élysée et la Madeleine. Maisons de couture, ambassades, hôtels particuliers transformés en appartements haussmanniens.',
  mapLat: 48.8718,
  mapLng: 2.3174,
  transports: ['M9 Saint-Philippe-du-Roule', 'M9 Miromesnil', 'M12 Madeleine', 'M14 Madeleine'],
  nearbyPlaces: ['Palais de l\'Élysée', 'Église de la Madeleine', 'Avenue des Champs-Élysées'],
  neighborhoodVibe: 'Prestigieux & feutré',
  mapTransports: [
    { name: 'Saint-Philippe-du-Roule', line: 'M9', lat: 48.8715, lng: 2.3108 },
    { name: 'Miromesnil', line: 'M9', lat: 48.8742, lng: 2.3148 },
    { name: 'Madeleine', line: 'M12', lat: 48.8703, lng: 2.3235 },
  ],
  mapPois: [
    { name: 'Palais de l\'Élysée', lat: 48.8701, lng: 2.3168 },
    { name: 'Église de la Madeleine', lat: 48.8700, lng: 2.3241 },
    { name: 'Avenue des Champs-Élysées', lat: 48.8718, lng: 2.3054 },
  ],
  marketAvgPricePerSqm: 19_500,
  marketEvolution10y: '+22%',
  marketHighPrice: 30_000,
  marketLowPrice: 14_000,
  videoUrl: '/videos/bien-3.mp4',
  imageUrlFallback:
    'https://images.unsplash.com/photo-1615874959474-d609969a20ed?w=800&h=1400&fit=crop&q=80',
  gallery: [
    'https://images.unsplash.com/photo-1615874959474-d609969a20ed?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1630699144867-37acec97df5a?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1617104551722-3b2d51bfb183?w=800&h=600&fit=crop&q=80',
  ],
  chapters: [
    { label: 'Hall', fraction: 0 },
    { label: 'Salon traversant', fraction: 0.18 },
  ],
  likeCount: 0,
  shareCount: 0,
  promising: false,
  badges: ['avant-premiere'],
  mandatType: 'SIMPLE',
  avantPremiere: true,
  refInterneAgence: 'KRZ-8-FSH-0211',
  statut: 'PUBLISHED',
  completionRate: 0.9,
}

export default async function EditBienPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let initial: Property = MOCK_PROPERTY

  if (id !== 'draft-001') {
    const dbProp = await prisma.property.findUnique({ where: { id } })
    if (dbProp) initial = toViewProperty(dbProp)
    console.log('[editer] llmFilledFields du bien:', dbProp?.llmFilledFields)
  }

  return <EditBienClient initialProperty={initial} />
}
