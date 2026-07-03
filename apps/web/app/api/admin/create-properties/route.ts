/**
 * POST /api/admin/create-properties   (header `x-admin-secret: <ADMIN_SECRET>`)
 *
 * Jalon 3 — LE PREMIER VRAI WRITE. Écrit en base les N biens démo validés par
 * Olivier (issus du Jalon 2, éventuellement édités dans les cards).
 *
 * Chaque bien : isDemoData=true, statut=PUBLISHED, agence tirée du pool existant,
 * pricePerSqm calculé, adresse exacte, mêmes videoUrl/imageUrlFallback (pattern
 * 1 vidéo → N biens). Réutilise les gardes de cohérence de seed-synthetic.
 *
 * Body : { properties: GeneratedProperty[], videoUrl: string, imageUrlFallback: string }
 * 200  : { count, createdIds, failed }
 */

import { NextRequest, NextResponse } from 'next/server'
import { PropertyStatus, MandatType, type DpeRating } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkAdminSecret } from '@/lib/auth/adminSecret'
import { coerceToProperty } from '@/lib/services/propertyDerivation'
import type { GeneratedProperty } from '@/lib/admin/tiktokStudioTypes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  if (!checkAdminSecret(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const b = body as {
    properties?: unknown
    videoUrl?: unknown
    imageUrlFallback?: unknown
  }
  if (typeof b.videoUrl !== 'string' || typeof b.imageUrlFallback !== 'string') {
    return NextResponse.json({ error: 'media_required' }, { status: 400 })
  }
  if (!Array.isArray(b.properties) || b.properties.length === 0) {
    return NextResponse.json({ error: 'properties_required' }, { status: 400 })
  }
  // Re-coercition défensive : les cards éditées côté client peuvent contenir
  // n'importe quoi. On repasse par les mêmes gardes que la génération.
  const properties = b.properties
    .map(coerceToProperty)
    .filter((p): p is GeneratedProperty => p !== null)
  if (properties.length === 0) {
    return NextResponse.json({ error: 'no_valid_properties' }, { status: 400 })
  }

  // Pool d'agences (mêmes que scrape-and-seed / seed-synthetic).
  const agencies = await prisma.agency.findMany({ include: { agents: true } })
  const pool = agencies
    .filter((a) => a.agents.length > 0)
    .map((a) => ({ agency: a, agent: a.agents[0] }))
  if (pool.length === 0) {
    return NextResponse.json(
      { error: 'no_agency', message: 'Aucune agence avec agent en base.' },
      { status: 500 },
    )
  }

  const createdIds: string[] = []
  let failed = 0

  for (let i = 0; i < properties.length; i++) {
    const p = properties[i]
    const attrib = pool[i % pool.length]

    // Gardes de cohérence (miroir de seed-synthetic insertOne).
    const terraceSurfaceM2 = p.hasTerrace ? (p.terraceSurfaceM2 ?? 8) : null
    const balconySurfaceM2 = p.hasBalcony ? (p.balconySurfaceM2 ?? 4) : null
    const floor = p.isGroundFloor ? 0 : p.floor
    const address = p.address.trim()

    try {
      const created = await prisma.property.create({
        data: {
          title: p.title,
          arrondissement: p.arrondissement,
          district: p.district,
          subtitle: p.subtitle,
          location: p.location,
          // Adresse exacte back-office (peut être vide si le LLM n'a rien produit).
          address: address || null,
          price: p.price,
          pricePerSqm: Math.round(p.price / Math.max(p.surface, 1)),
          surface: p.surface,
          rooms: p.rooms,
          bedrooms: p.bedrooms,
          description: p.description,
          tags: p.tags,
          features: p.features,
          dpe: p.dpe as DpeRating,
          ges: p.ges as DpeRating,
          floor,
          totalFloors: p.totalFloors,
          monthlyCharges: p.monthlyCharges,
          propertyTax: p.propertyTax,
          neighborhoodVibe: p.neighborhoodVibe,
          yearBuilt: p.yearBuilt,
          // Zone affichée sur la sheet — placeholder démo plausible (le quartier).
          // La vraie zone IRIS géocodée depuis l'adresse est un upgrade différé.
          irisZone: p.district,
          // Attributs structurés (moteur matching)
          hasElevator: p.hasElevator,
          hasTerrace: p.hasTerrace,
          terraceSurfaceM2,
          hasBalcony: p.hasBalcony,
          balconySurfaceM2,
          hasGarden: p.hasGarden,
          hasCellar: p.hasCellar,
          hasParking: p.hasParking,
          hasConcierge: p.hasConcierge,
          isGroundFloor: p.isGroundFloor,
          isQuietStreet: p.isQuietStreet,
          orientationStructured: p.orientationStructured,
          // Scores sémantiques
          luminosity: p.luminosity,
          quietness: p.quietness,
          charm: p.charm,
          spaciousness: p.spaciousness,
          livingQuality: p.livingQuality,
          outdoorUsability: p.outdoorUsability,
          // Média (partagé — pattern 1 vidéo → N biens)
          videoUrl: b.videoUrl as string,
          imageUrlFallback: b.imageUrlFallback as string,
          // Agence / agent
          agencyId: attrib.agency.id,
          createdByAgentId: attrib.agent.id,
          agentName: attrib.agent.name,
          agentAvatar: attrib.agent.avatar,
          // Statut / démo
          statut: PropertyStatus.PUBLISHED,
          mandatType: MandatType.SIMPLE,
          completionRate: 0.75,
          isDemoData: true,
        },
        select: { id: true },
      })
      createdIds.push(created.id)
    } catch (err) {
      console.error('[create-properties] insert failed:', err)
      failed += 1
    }
  }

  if (createdIds.length === 0) {
    return NextResponse.json({ error: 'all_inserts_failed', failed }, { status: 500 })
  }
  return NextResponse.json({ count: createdIds.length, createdIds, failed })
}
