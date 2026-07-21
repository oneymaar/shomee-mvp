/**
 * Shomee — Prisma → view-model serializer for Property.
 *
 * The DB layer (Prisma) and the feed UI use the same field names but differ
 * on three points:
 *   1. Nullables: Prisma returns `T | null` for nullable scalar fields, while
 *      the view model expects `T | undefined`.
 *   2. Badges enum: Prisma uses `AVANT_PREMIERE | EXCLUSIVITE`, the UI uses
 *      kebab-case (`'avant-premiere' | 'exclusivite'`).
 *   3. JSON columns: `composition`, `chapters`, `mapTransports`, `mapPois`,
 *      `irisPolygon` come back as `Prisma.JsonValue` and need a typed cast.
 */

import type { Property as PrismaProperty, PropertyBadge } from '@prisma/client'
import type { Property } from '@/lib/types'

const BADGE_MAP: Record<PropertyBadge, 'avant-premiere' | 'exclusivite'> = {
  AVANT_PREMIERE: 'avant-premiere',
  EXCLUSIVITE: 'exclusivite',
}

function nullToUndef<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

export function toViewProperty(p: PrismaProperty): Property {
  return {
    id: p.id,
    arrondissement: p.arrondissement,
    subtitle: p.subtitle,
    agentName: p.agentName,
    agentAvatar: nullToUndef(p.agentAvatar),

    title: p.title,
    price: p.price,
    pricePerSqm: nullToUndef(p.pricePerSqm),
    surface: p.surface,
    rooms: p.rooms,
    bedrooms: nullToUndef(p.bedrooms),
    location: p.location,
    district: p.district,
    description: p.description,
    tags: p.tags,
    features: p.features.length > 0 ? p.features : undefined,
    dpe: p.dpe,
    ges: nullToUndef(p.ges),

    floor: nullToUndef(p.floor),
    totalFloors: nullToUndef(p.totalFloors),
    orientation: nullToUndef(p.orientation),
    exteriorType: nullToUndef(p.exteriorType),
    heatingType: nullToUndef(p.heatingType),
    hotWaterType: nullToUndef(p.hotWaterType),
    yearBuilt: nullToUndef(p.yearBuilt),
    lotCount: nullToUndef(p.lotCount),
    proceduresEnCours: nullToUndef(p.proceduresEnCours),
    monthlyCharges: nullToUndef(p.monthlyCharges),
    propertyTax: nullToUndef(p.propertyTax),

    composition: (p.composition as Array<{ label: string; surface: number }> | null) ?? undefined,

    irisZone: nullToUndef(p.irisZone),
    irisDescription: nullToUndef(p.irisDescription),
    irisPolygon: (p.irisPolygon as [number, number][] | null) ?? undefined,
    mapLat: nullToUndef(p.mapLat),
    mapLng: nullToUndef(p.mapLng),
    transports: p.transports.length > 0 ? p.transports : undefined,
    nearbyPlaces: p.nearbyPlaces.length > 0 ? p.nearbyPlaces : undefined,
    neighborhoodVibe: nullToUndef(p.neighborhoodVibe),
    mapTransports:
      (p.mapTransports as Array<{
        name: string
        line: string
        lat: number
        lng: number
        walkMin?: number
      }> | null) ?? undefined,
    mapPois:
      (p.mapPois as Array<{ name: string; lat: number; lng: number }> | null) ?? undefined,

    marketAvgPricePerSqm: nullToUndef(p.marketAvgPricePerSqm),
    marketEvolution10y: nullToUndef(p.marketEvolution10y),
    marketHighPrice: nullToUndef(p.marketHighPrice),
    marketLowPrice: nullToUndef(p.marketLowPrice),

    videoUrl: nullToUndef(p.videoUrl),
    matterportUrl: nullToUndef(p.matterportUrl),
    imageUrlFallback: p.imageUrlFallback,
    gallery: p.gallery,
    chapters:
      (p.chapters as Array<{ label: string; fraction: number }> | null) ?? undefined,

    likeCount: p.likeCount,
    shareCount: p.shareCount,
    promising: p.promising,
    badges: p.badges.length > 0 ? p.badges.map((b) => BADGE_MAP[b]) : undefined,

    // Sprint fields
    mandatType: p.mandatType,
    avantPremiere: p.avantPremiere,
    refInterneAgence: nullToUndef(p.refInterneAgence),
    statut: p.statut,
    completionRate: p.completionRate,
    agencyId: p.agencyId,
    createdByAgentId: p.createdByAgentId,
    collaborateurIds: p.collaborateurIds,

    // Structured attributes
    hasElevator: nullToUndef(p.hasElevator),
    hasTerrace: nullToUndef(p.hasTerrace),
    terraceSurfaceM2: nullToUndef(p.terraceSurfaceM2),
    hasBalcony: nullToUndef(p.hasBalcony),
    balconySurfaceM2: nullToUndef(p.balconySurfaceM2),
    hasGarden: nullToUndef(p.hasGarden),
    gardenSurfaceM2: nullToUndef(p.gardenSurfaceM2),
    hasCellar: nullToUndef(p.hasCellar),
    hasParking: nullToUndef(p.hasParking),
    hasConcierge: nullToUndef(p.hasConcierge),
    isGroundFloor: nullToUndef(p.isGroundFloor),
    bedroomStreetSide: nullToUndef(p.bedroomStreetSide),
    isQuietStreet: nullToUndef(p.isQuietStreet),
    orientationStructured:
      p.orientationStructured.length > 0
        ? (p.orientationStructured as Array<'north' | 'south' | 'east' | 'west'>)
        : undefined,

    luminosity: nullToUndef(p.luminosity),
    quietness: nullToUndef(p.quietness),
    charm: nullToUndef(p.charm),
    spaciousness: nullToUndef(p.spaciousness),
    livingQuality: nullToUndef(p.livingQuality),
    outdoorUsability: nullToUndef(p.outdoorUsability),

    // LLM-fill marker + per-field source markers
    llmFilledFields:        p.llmFilledFields,
    locationSource:         p.locationSource,
    titleSource:            p.titleSource,
    priceSource:            p.priceSource,
    surfaceSource:          p.surfaceSource,
    roomsSource:            p.roomsSource,
    bedroomsSource:         p.bedroomsSource,
    descriptionSource:      p.descriptionSource,
    floorSource:            p.floorSource,
    yearBuiltSource:        p.yearBuiltSource,
    dpeSource:              p.dpeSource,
    gesSource:              p.gesSource,
    mandatTypeSource:       p.mandatTypeSource,
    refInterneAgenceSource: p.refInterneAgenceSource,
    monthlyChargesSource:   p.monthlyChargesSource,
    propertyTaxSource:      p.propertyTaxSource,
    compositionSource:      p.compositionSource,
  }
}
