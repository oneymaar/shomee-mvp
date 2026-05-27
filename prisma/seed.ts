/**
 * Shomee — database seed
 *
 * Seeds 1 luxury agency, 1 agent, and 3 high-end properties (Paris 7, 16, 8).
 * Run with:
 *   npx prisma db seed
 *   (or)  node --experimental-strip-types prisma/seed.ts
 */

import 'dotenv/config'
import { PrismaClient, AgencyPlan, MandatType, PropertyStatus, DpeRating, PropertyBadge, UserRole } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Reset (idempotent re-runs)
  await prisma.document.deleteMany()
  await prisma.videoAnalysis.deleteMany()
  await prisma.propertyTag.deleteMany()
  await prisma.property.deleteMany()
  await prisma.agent.deleteMany()
  await prisma.agency.deleteMany()
  await prisma.buyerProfile.deleteMany()
  await prisma.user.deleteMany()

  // ── Agency ──────────────────────────────────────────────────────────────
  const agency = await prisma.agency.create({
    data: {
      name: 'Kretz Real Estate',
      logo: '/agencies/Logo Kretz.png',
      plan: AgencyPlan.PREMIUM,
      maxProperties: 200,
    },
  })

  // ── Agent ───────────────────────────────────────────────────────────────
  const agent = await prisma.agent.create({
    data: {
      name: 'Olivier Kretz',
      email: 'olivier.kretz@kretz-realestate.fr',
      avatar: '/agencies/Logo Kretz.png',
      agencyId: agency.id,
    },
  })

  // ── Demo buyer (for matching tests) ─────────────────────────────────────
  const buyer = await prisma.user.create({
    data: {
      email: 'demo.buyer@shomee.fr',
      name: 'Acheteur Démo',
      role: UserRole.BUYER,
      buyerProfile: {
        create: {
          parsedCriteria: [],
          rawTags: ['Extérieur', 'Charme ancien', 'Calme'],
          searchPreferences: {
            budgetMin: 3_000_000,
            budgetMax: 7_000_000,
            propertyTypes: ['appartement'],
            minRooms: 4,
            minSurface: 130,
          },
        },
      },
    },
  })

  // ── Property 1 — Paris 7e — Hôtel particulier Invalides ─────────────────
  const p1 = await prisma.property.create({
    data: {
      arrondissement: 'PARIS 7e',
      subtitle: 'Hôtel particulier Invalides',
      agentName: 'Kretz · Faubourg Saint-Germain',
      agentAvatar: '/agencies/Logo Kretz.png',

      title: 'Hôtel particulier 240m² — Invalides',
      price: 6_500_000,
      pricePerSqm: 27_083,
      surface: 240,
      rooms: 8,
      bedrooms: 4,
      location: 'Paris 75007',
      district: 'Invalides — Faubourg Saint-Germain',
      description:
        "Exceptionnel hôtel particulier sur cour pavée au cœur du Faubourg Saint-Germain. Réception en enfilade de 95m² avec parquet Versailles, moulures et cheminées d'époque, vue dégagée sur les Invalides. Cuisine professionnelle, suite parentale avec dressing et salle de bain en marbre, trois chambres supplémentaires. Cave voûtée, parking en sous-sol, ascenseur privatif.",
      tags: ['Charme ancien', 'Calme', 'Lumineux'],
      features: [
        'Parquet Versailles',
        'Moulures',
        'Cheminées d\'époque',
        'Cave voûtée',
        'Parking',
        'Ascenseur privatif',
        'Gardien',
      ],
      dpe: DpeRating.B,
      ges: DpeRating.B,
      floor: 2,
      totalFloors: 4,
      orientation: 'Sud',
      exteriorType: 'Cour pavée + balcon filant',
      heatingType: 'Collectif (gaz)',
      hotWaterType: 'Collectif (gaz)',
      yearBuilt: 1850,
      lotCount: 6,
      proceduresEnCours: false,
      monthlyCharges: 1_650,
      propertyTax: 12_500,

      composition: [
        { label: 'Galerie / réception', surface: 95 },
        { label: 'Cuisine professionnelle', surface: 22 },
        { label: 'Suite parentale + dressing', surface: 38 },
        { label: 'Chambre 2', surface: 22 },
        { label: 'Chambre 3', surface: 18 },
        { label: 'Chambre 4', surface: 16 },
        { label: 'Salle de bain marbre', surface: 14 },
        { label: 'Salle d\'eau', surface: 7 },
        { label: 'Bureau / bibliothèque', surface: 8 },
      ],

      irisZone: 'Invalides — Saint-Thomas-d\'Aquin',
      irisDescription:
        'Micro-quartier le plus discret du 7e, entre les Invalides et le boulevard Saint-Germain. Architecture XVIIIᵉ, ambassades, hôtels particuliers privés.',
      mapLat: 48.857_8,
      mapLng: 2.317_3,
      transports: ['M8 La Tour-Maubourg', 'M13 Varenne', 'RER C Invalides'],
      nearbyPlaces: ['Hôtel des Invalides', 'Musée Rodin', 'Boulevard Saint-Germain'],
      neighborhoodVibe: 'Aristocratique & confidentiel',
      mapTransports: [
        { name: 'La Tour-Maubourg', line: 'M8', lat: 48.860_8, lng: 2.310_8 },
        { name: 'Varenne', line: 'M13', lat: 48.857_3, lng: 2.318_8 },
        { name: 'Invalides', line: 'RER C', lat: 48.860_5, lng: 2.314_6 },
      ],
      mapPois: [
        { name: 'Hôtel des Invalides', lat: 48.857_1, lng: 2.312_7 },
        { name: 'Musée Rodin', lat: 48.855_3, lng: 2.315_8 },
        { name: 'Champ-de-Mars', lat: 48.855_7, lng: 2.298_2 },
      ],

      marketAvgPricePerSqm: 21_500,
      marketEvolution10y: '+24%',
      marketHighPrice: 32_000,
      marketLowPrice: 16_500,

      videoUrl: '/videos/bien-1.mp4',
      imageUrlFallback:
        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&h=1400&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&h=600&fit=crop&q=80',
        'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800&h=600&fit=crop&q=80',
        'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=800&h=600&fit=crop&q=80',
      ],
      chapters: [
        { label: 'Cour', fraction: 0 },
        { label: 'Galerie', fraction: 0.18 },
        { label: 'Cuisine', fraction: 0.42 },
        { label: 'Suite parentale', fraction: 0.58 },
        { label: 'Bibliothèque', fraction: 0.78 },
      ],

      likeCount: 412,
      shareCount: 138,
      promising: false,
      badges: [PropertyBadge.AVANT_PREMIERE, PropertyBadge.EXCLUSIVITE],

      // Structured attributes
      hasElevator: true,
      hasTerrace: false,
      hasBalcony: true,
      balconySurfaceM2: 6,
      hasGarden: false,
      hasCellar: true,
      hasParking: true,
      hasConcierge: true,
      isGroundFloor: false,
      isQuietStreet: true,
      bedroomStreetSide: false,
      orientationStructured: ['south'],

      // Semantic scores
      luminosity: 0.78,
      quietness: 0.92,
      charm: 0.96,
      spaciousness: 0.94,
      livingQuality: 0.93,
      outdoorUsability: 0.42,

      // Sprint
      mandatType: MandatType.EXCLUSIF,
      avantPremiere: true,
      refInterneAgence: 'KRZ-7-INV-0142',
      statut: PropertyStatus.PUBLISHED,
      completionRate: 0.95,
      collaborateurIds: [],

      agencyId: agency.id,
      createdByAgentId: agent.id,
    },
  })

  // ── Property 2 — Paris 16e — Penthouse Trocadéro ────────────────────────
  const p2 = await prisma.property.create({
    data: {
      arrondissement: 'PARIS 16e',
      subtitle: 'Penthouse Trocadéro',
      agentName: 'Kretz · Trocadéro',
      agentAvatar: '/agencies/Logo Kretz.png',

      title: 'Penthouse 180m² — Vue Tour Eiffel',
      price: 4_200_000,
      pricePerSqm: 23_333,
      surface: 180,
      rooms: 5,
      bedrooms: 3,
      location: 'Paris 75016',
      district: 'Trocadéro — Passy',
      description:
        "Penthouse au dernier étage d'un immeuble Art Déco, vue panoramique frontale sur la Tour Eiffel et le Champ-de-Mars. Vaste terrasse plein ciel de 52m² orientée sud-ouest, double séjour traversant, cuisine ouverte signée Bulthaup. Trois chambres dont une suite parentale avec dressing. Gardien 24h/24, parking double, cave.",
      tags: ['Vue exceptionnelle', 'Extérieur', 'Lumineux'],
      features: [
        'Vue Tour Eiffel',
        'Terrasse 52m²',
        'Double séjour traversant',
        'Cuisine Bulthaup',
        'Parking double',
        'Gardien 24h',
        'Ascenseur direct',
      ],
      dpe: DpeRating.C,
      ges: DpeRating.C,
      floor: 7,
      totalFloors: 7,
      orientation: 'Sud-Ouest',
      exteriorType: 'Terrasse 52m²',
      heatingType: 'Individuel (gaz)',
      hotWaterType: 'Individuel (gaz)',
      yearBuilt: 1925,
      lotCount: 14,
      proceduresEnCours: false,
      monthlyCharges: 980,
      propertyTax: 6_800,

      composition: [
        { label: 'Double séjour traversant', surface: 62 },
        { label: 'Cuisine ouverte Bulthaup', surface: 18 },
        { label: 'Terrasse plein ciel', surface: 52 },
        { label: 'Suite parentale + dressing', surface: 28 },
        { label: 'Chambre 2', surface: 16 },
        { label: 'Chambre 3', surface: 14 },
        { label: 'Salle de bain', surface: 10 },
        { label: 'Salle d\'eau', surface: 6 },
        { label: 'Entrée', surface: 6 },
      ],

      irisZone: 'Trocadéro — Chaillot',
      irisDescription:
        'Triangle Trocadéro-Iéna-Boissière, immeubles haussmanniens et Art Déco face à la Tour Eiffel. Le micro-quartier le plus exposé du 16e.',
      mapLat: 48.863_2,
      mapLng: 2.288_4,
      transports: ['M6 Trocadéro', 'M9 Iéna', 'M6 Boissière', 'Bus 32'],
      nearbyPlaces: ['Palais de Chaillot', 'Jardins du Trocadéro', 'Pont d\'Iéna'],
      neighborhoodVibe: 'Bourgeois & panoramique',
      mapTransports: [
        { name: 'Trocadéro', line: 'M6', lat: 48.863_5, lng: 2.288_3 },
        { name: 'Iéna', line: 'M9', lat: 48.864_8, lng: 2.293_8 },
        { name: 'Boissière', line: 'M6', lat: 48.866_8, lng: 2.289_6 },
      ],
      mapPois: [
        { name: 'Palais de Chaillot', lat: 48.862_3, lng: 2.289_3 },
        { name: 'Tour Eiffel', lat: 48.858_4, lng: 2.294_3 },
        { name: 'Bois de Boulogne (entrée)', lat: 48.866_5, lng: 2.275_1 },
      ],

      marketAvgPricePerSqm: 16_800,
      marketEvolution10y: '+19%',
      marketHighPrice: 26_000,
      marketLowPrice: 12_500,

      videoUrl: '/videos/bien-2.mp4',
      imageUrlFallback:
        'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&h=1400&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&h=600&fit=crop&q=80',
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&h=600&fit=crop&q=80',
        'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop&q=80',
      ],
      chapters: [
        { label: 'Entrée', fraction: 0 },
        { label: 'Séjour', fraction: 0.15 },
        { label: 'Terrasse', fraction: 0.38 },
        { label: 'Cuisine', fraction: 0.55 },
        { label: 'Suite', fraction: 0.74 },
        { label: 'Vue panoramique', fraction: 0.88 },
      ],

      likeCount: 587,
      shareCount: 224,
      promising: true,
      badges: [PropertyBadge.EXCLUSIVITE],

      hasElevator: true,
      hasTerrace: true,
      terraceSurfaceM2: 52,
      hasBalcony: false,
      hasGarden: false,
      hasCellar: true,
      hasParking: true,
      hasConcierge: true,
      isGroundFloor: false,
      isQuietStreet: true,
      bedroomStreetSide: false,
      orientationStructured: ['south', 'west'],

      luminosity: 0.95,
      quietness: 0.78,
      charm: 0.82,
      spaciousness: 0.88,
      livingQuality: 0.94,
      outdoorUsability: 0.97,

      mandatType: MandatType.EXCLUSIF,
      avantPremiere: false,
      refInterneAgence: 'KRZ-16-TRO-0089',
      statut: PropertyStatus.PUBLISHED,
      completionRate: 0.97,
      collaborateurIds: [],

      agencyId: agency.id,
      createdByAgentId: agent.id,
    },
  })

  // ── Property 3 — Paris 8e — Appartement Faubourg Saint-Honoré ───────────
  const p3 = await prisma.property.create({
    data: {
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
      location: 'Paris 75008',
      district: 'Faubourg Saint-Honoré — Madeleine',
      description:
        "Haussmannien classique au 4ᵉ étage d'un immeuble pierre de taille rue du Faubourg Saint-Honoré. Réception double traversante avec balcon filant côté rue, parquet point de Hongrie, moulures et cheminées en marbre d'origine. Trois chambres côté cour silencieuse, dressing, cuisine équipée. Cave et accès direct ascenseur.",
      tags: ['Charme ancien', 'Traversant', 'Lumineux'],
      features: [
        'Parquet point de Hongrie',
        'Moulures',
        'Cheminées marbre',
        'Balcon filant',
        'Pierre de taille',
        'Cave',
        'Ascenseur',
        'Gardien',
      ],
      dpe: DpeRating.B,
      ges: DpeRating.C,
      floor: 4,
      totalFloors: 6,
      orientation: 'Est-Ouest traversant',
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
      mapLat: 48.871_8,
      mapLng: 2.317_4,
      transports: ['M9 Saint-Philippe-du-Roule', 'M9 Miromesnil', 'M12 Madeleine', 'M14 Madeleine'],
      nearbyPlaces: ['Palais de l\'Élysée', 'Église de la Madeleine', 'Avenue des Champs-Élysées'],
      neighborhoodVibe: 'Prestigieux & feutré',
      mapTransports: [
        { name: 'Saint-Philippe-du-Roule', line: 'M9', lat: 48.871_5, lng: 2.310_8 },
        { name: 'Miromesnil', line: 'M9', lat: 48.874_2, lng: 2.314_8 },
        { name: 'Madeleine', line: 'M12', lat: 48.870_3, lng: 2.323_5 },
      ],
      mapPois: [
        { name: 'Palais de l\'Élysée', lat: 48.870_1, lng: 2.316_8 },
        { name: 'Église de la Madeleine', lat: 48.870_0, lng: 2.324_1 },
        { name: 'Avenue des Champs-Élysées', lat: 48.871_8, lng: 2.305_4 },
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
        { label: 'Cuisine', fraction: 0.42 },
        { label: 'Chambre parentale', fraction: 0.60 },
        { label: 'Salle de bain', fraction: 0.78 },
        { label: 'Vue balcon', fraction: 0.90 },
      ],

      likeCount: 268,
      shareCount: 91,
      promising: false,
      badges: [PropertyBadge.AVANT_PREMIERE],

      hasElevator: true,
      hasTerrace: false,
      hasBalcony: true,
      balconySurfaceM2: 8,
      hasGarden: false,
      hasCellar: true,
      hasParking: false,
      hasConcierge: true,
      isGroundFloor: false,
      isQuietStreet: false,
      bedroomStreetSide: false,
      orientationStructured: ['east', 'west'],

      luminosity: 0.86,
      quietness: 0.71,
      charm: 0.93,
      spaciousness: 0.81,
      livingQuality: 0.89,
      outdoorUsability: 0.38,

      mandatType: MandatType.SIMPLE,
      avantPremiere: true,
      refInterneAgence: 'KRZ-8-FSH-0211',
      statut: PropertyStatus.PUBLISHED,
      completionRate: 0.90,
      collaborateurIds: [],

      agencyId: agency.id,
      createdByAgentId: agent.id,
    },
  })

  console.log('✓ Seed completed:')
  console.log(`  agency:    ${agency.name} (${agency.id})`)
  console.log(`  agent:     ${agent.name} (${agent.id})`)
  console.log(`  buyer:     ${buyer.email} (${buyer.id})`)
  console.log(`  property1: ${p1.title} — ${p1.id}`)
  console.log(`  property2: ${p2.title} — ${p2.id}`)
  console.log(`  property3: ${p3.title} — ${p3.id}`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
