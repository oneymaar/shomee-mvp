import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { PropertyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { id } = await params

  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      propertyTags: { orderBy: { createdAt: 'asc' } },
      videoAnalysis: true,
      documents: true,
    },
  })

  if (!property) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }

  if (property.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  return NextResponse.json(property)
}

// Allowed status transitions — guard against impossible jumps.
const ALLOWED_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  DRAFT:       [PropertyStatus.PUBLISHED],
  PUBLISHED:   [PropertyStatus.UNPUBLISHED],
  UNPUBLISHED: [PropertyStatus.PUBLISHED, PropertyStatus.ARCHIVED],
  ARCHIVED:    [PropertyStatus.UNPUBLISHED],
}

const DpeSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
const StatutSchema = z.enum(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'])
const MandatSchema = z.enum(['EXCLUSIF', 'SIMPLE', 'COEXCLUSIF'])
const OrientationSchema = z.enum(['north', 'south', 'east', 'west'])
const BadgeSchema = z.enum(['AVANT_PREMIERE', 'EXCLUSIVITE'])

const CompositionRowSchema = z.object({
  label: z.string(),
  surface: z.number(),
})

// Front model emits {label, fraction} OR {label, startSec}. Accept both shapes.
const ChapterSchema = z.object({
  label: z.string(),
  fraction: z.number().min(0).max(1).optional(),
  startSec: z.number().optional(),
}).passthrough()

const MapTransportSchema = z.object({
  name: z.string(),
  line: z.string(),
  lat: z.number(),
  lng: z.number(),
})

const MapPoiSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
})

// Partial schema — every key optional, so any subset can be sent.
const PropertyPatchSchema = z.object({
  // Status (kept separate from content for transition guard)
  statut: StatutSchema,

  // Feed display
  arrondissement: z.string(),
  subtitle: z.string(),
  agentName: z.string(),
  agentAvatar: z.string().nullable(),

  // Core
  title: z.string(),
  price: z.number().int(),
  pricePerSqm: z.number().int().nullable(),
  surface: z.number(),
  rooms: z.number().int(),
  bedrooms: z.number().int().nullable(),
  location: z.string(),
  district: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  features: z.array(z.string()),
  dpe: DpeSchema,
  ges: DpeSchema.nullable(),

  // Physical
  floor: z.number().int().nullable(),
  totalFloors: z.number().int().nullable(),
  orientation: z.string().nullable(),
  exteriorType: z.string().nullable(),
  heatingType: z.string().nullable(),
  hotWaterType: z.string().nullable(),
  yearBuilt: z.number().int().nullable(),
  lotCount: z.number().int().nullable(),
  proceduresEnCours: z.boolean().nullable(),
  monthlyCharges: z.number().int().nullable(),
  propertyTax: z.number().int().nullable(),

  // Composition / IRIS / map / market
  composition: z.array(CompositionRowSchema).nullable(),
  irisZone: z.string().nullable(),
  irisDescription: z.string().nullable(),
  irisPolygon: z.array(z.tuple([z.number(), z.number()])).nullable(),
  mapLat: z.number().nullable(),
  mapLng: z.number().nullable(),
  transports: z.array(z.string()),
  nearbyPlaces: z.array(z.string()),
  neighborhoodVibe: z.string().nullable(),
  mapTransports: z.array(MapTransportSchema).nullable(),
  mapPois: z.array(MapPoiSchema).nullable(),
  marketAvgPricePerSqm: z.number().int().nullable(),
  marketEvolution10y: z.string().nullable(),
  marketHighPrice: z.number().int().nullable(),
  marketLowPrice: z.number().int().nullable(),

  // Media
  videoUrl: z.string().nullable(),
  matterportUrl: z.string().nullable(),
  imageUrlFallback: z.string(),
  gallery: z.array(z.string()),
  chapters: z.array(ChapterSchema).nullable(),

  // Sprint
  mandatType: MandatSchema,
  avantPremiere: z.boolean(),
  refInterneAgence: z.string().nullable(),
  completionRate: z.number(),
  badges: z.array(BadgeSchema),

  // Structured attributes
  hasElevator: z.boolean(),
  hasTerrace: z.boolean(),
  terraceSurfaceM2: z.number().nullable(),
  hasBalcony: z.boolean(),
  balconySurfaceM2: z.number().nullable(),
  hasGarden: z.boolean(),
  gardenSurfaceM2: z.number().nullable(),
  hasCellar: z.boolean(),
  hasParking: z.boolean(),
  hasConcierge: z.boolean(),
  isGroundFloor: z.boolean(),
  bedroomStreetSide: z.boolean().nullable(),
  isQuietStreet: z.boolean().nullable(),
  orientationStructured: z.array(OrientationSchema),

  // Semantic
  luminosity: z.number().nullable(),
  quietness: z.number().nullable(),
  charm: z.number().nullable(),
  spaciousness: z.number().nullable(),
  livingQuality: z.number().nullable(),
  outdoorUsability: z.number().nullable(),
}).partial()

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { id } = await params

  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = PropertyPatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation', details: parsed.error.issues }, { status: 400 })
  }

  const existing = await prisma.property.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }
  if (existing.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { statut: nextStatut, ...contentPatch } = parsed.data
  const hasContentChanges = Object.keys(contentPatch).length > 0

  // Auto-save / content edits are only allowed while the bien is in DRAFT —
  // publishing happens through an explicit statut transition.
  if (hasContentChanges && existing.statut !== PropertyStatus.DRAFT) {
    return NextResponse.json(
      { error: 'Édition interdite : le bien doit être en brouillon' },
      { status: 403 },
    )
  }

  // Status transition guard.
  if (nextStatut !== undefined && nextStatut !== existing.statut) {
    if (!ALLOWED_TRANSITIONS[existing.statut].includes(nextStatut)) {
      return NextResponse.json(
        { error: `Transition interdite : ${existing.statut} → ${nextStatut}` },
        { status: 409 },
      )
    }
  }

  const data: Record<string, unknown> = { ...contentPatch }
  if (nextStatut !== undefined) data.statut = nextStatut

  const updated = await prisma.property.update({
    where: { id },
    data,
    select: { id: true, statut: true, updatedAt: true },
  })

  // Drop the Router Cache so when the agent goes editor → preview → back the
  // editor re-renders with the freshly-saved data instead of the stale RSC
  // payload from its initial mount.
  revalidatePath(`/agent/biens/${id}/editer`)
  revalidatePath(`/agent/biens/${id}/preview`)

  return NextResponse.json({ success: true, ...updated })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { id } = await params

  const existing = await prisma.property.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }
  if (existing.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Hard delete is only allowed from DRAFT or ARCHIVED.
  if (existing.statut !== PropertyStatus.DRAFT && existing.statut !== PropertyStatus.ARCHIVED) {
    return NextResponse.json(
      { error: 'Suppression interdite : archivez le bien avant de le supprimer.' },
      { status: 409 },
    )
  }

  await prisma.property.delete({ where: { id } })
  return NextResponse.json({ success: true, id })
}
