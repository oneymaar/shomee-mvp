import type { Property } from './types'

export const properties: Property[] = [
  {
    id: '1',
    arrondissement: 'PARIS 18e',
    subtitle: 'Penthouse en duplex',
    agentName: 'Agence Junot',
    title: 'Penthouse duplex Montmartre',
    price: 1490000,
    pricePerSqm: 12957,
    surface: 115,
    rooms: 5,
    bedrooms: 3,
    location: 'Paris 75018',
    district: 'Montmartre',
    description:
      "Exceptionnel penthouse en duplex au sommet d'un immeuble de caractère à Montmartre. Vue panoramique sur Paris, terrasse privative, double séjour avec verrière. Finitions haut de gamme, parquet massif, cuisine ouverte équipée. Rare sur le marché.",
    tags: ['Extérieur', 'Lumineux', 'Charme ancien'],
    features: ['Terrasse', 'Vue panoramique', 'Duplex', 'Cave'],
    dpe: 'C',
    ges: 'C',
    videoUrl: '/videos/bien-1.mp4',
    imageUrlFallback:
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&h=1400&fit=crop&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&h=600&fit=crop&q=80',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800&h=600&fit=crop&q=80',
      'https://images.unsplash.com/photo-1600573472550-8090b5e0745e?w=800&h=600&fit=crop&q=80',
    ],
    chapters: [
      { label: 'Entrée',        fraction: 0    },  //  0s / 24.94s
      { label: 'Terrasse',      fraction: 0.12 },  //  3s / 24.94s
      { label: 'Salon',         fraction: 0.20 },  //  5s / 24.94s
      { label: 'Chambre',       fraction: 0.32 },  //  8s / 24.94s
      { label: 'Salle de bain', fraction: 0.48 },  // 12s / 24.94s
      { label: 'Entrée',        fraction: 0.52 },  // 13s / 24.94s
      { label: 'Salon',         fraction: 0.64 },  // 16s / 24.94s
      { label: 'Terrasse',      fraction: 0.76 },  // 19s / 24.94s
      { label: 'Salon',         fraction: 0.84 },  // 21s / 24.94s
    ],
    likeCount: 312,
    shareCount: 94,
    promising: true,
  },
  {
    id: '2',
    arrondissement: 'PARIS 4e',
    subtitle: 'T2 Île Saint-Louis',
    agentName: 'Agence Frédélion',
    title: 'T2 Île Saint-Louis',
    price: 580000,
    pricePerSqm: 15263,
    surface: 38,
    rooms: 2,
    bedrooms: 1,
    location: 'Paris 75004',
    district: 'Île Saint-Louis',
    description:
      "Charmant T2 au cœur de l'Île Saint-Louis, l'un des quartiers les plus prisés de Paris. Pierres apparentes, poutres d'époque, vue sur cour arborée. Cuisine rénovée, salle de bain refaite à neuf. Idéal résidence principale ou investissement.",
    tags: ['Charme ancien', 'Calme', 'Lumineux'],
    features: ['Pierres apparentes', 'Poutres', 'Cour', 'Cave'],
    dpe: 'D',
    ges: 'D',
    videoUrl: '/videos/bien-2.mp4',
    imageUrlFallback:
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&h=1400&fit=crop&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&h=600&fit=crop&q=80',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&h=600&fit=crop&q=80',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop&q=80',
    ],
    chapters: [
      { label: 'Salle à manger', fraction: 0    },  //  0s / 16.95s
      { label: 'Salon',          fraction: 0.41 },  //  7s / 16.95s
      { label: 'Chambre',        fraction: 0.83 },  // 14s / 16.95s
    ],
    likeCount: 187,
    shareCount: 52,
    promising: false,
  },
  {
    id: '3',
    arrondissement: 'PARIS 6e',
    subtitle: 'T4 Saint-Germain-des-Prés',
    agentName: 'Kretz Real Estate',
    title: 'T4 Saint-Germain-des-Prés',
    price: 2350000,
    pricePerSqm: 25824,
    surface: 91,
    rooms: 4,
    bedrooms: 2,
    location: 'Paris 75006',
    district: 'Saint-Germain-des-Prés',
    description:
      "Somptueux T4 dans un hôtel particulier du XVIIe siècle au cœur de Saint-Germain-des-Prés. Grand séjour traversant avec moulures d'époque, deux chambres en suite, cuisine équipée haut de gamme. Cachet exceptionnel, prestations luxe.",
    tags: ['Charme ancien', 'Calme', 'Lumineux'],
    features: ['Hôtel particulier', 'Moulures', 'Gardien', 'Cave', 'Ascenseur'],
    dpe: 'B',
    ges: 'B',
    videoUrl: '/videos/bien-3.mp4',
    imageUrlFallback:
      'https://images.unsplash.com/photo-1615874959474-d609969a20ed?w=800&h=1400&fit=crop&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1615874959474-d609969a20ed?w=800&h=600&fit=crop&q=80',
      'https://images.unsplash.com/photo-1630699144867-37acec97df5a?w=800&h=600&fit=crop&q=80',
      'https://images.unsplash.com/photo-1617104551722-3b2d51bfb183?w=800&h=600&fit=crop&q=80',
    ],
    chapters: [
      { label: 'Quartier',          fraction: 0    },  //  0s / 47.23s
      { label: 'Séjour',            fraction: 0.15 },  //  7s / 47.23s
      { label: 'Cuisine',           fraction: 0.47 },  // 22s / 47.23s
      { label: 'Chambre parentale', fraction: 0.66 },  // 31s / 47.23s
      { label: 'Chambre enfant',    fraction: 0.72 },  // 34s / 47.23s
      { label: 'Séjour',            fraction: 0.80 },  // 38s / 47.23s
    ],
    likeCount: 326,
    shareCount: 164,
    promising: true,
  },
]
