/**
 * Shomee — Prisma Property → matching engine PropertyProfile bridge.
 *
 * Pure mapping; no I/O. The engine sees only the deterministic subset of
 * a Property's columns plus the precomputed semantic scores. Anything the
 * engine doesn't read (price, agent metadata, media, market data) is
 * dropped on purpose.
 *
 * Field-name reality check vs. the schema:
 *  - PropertyProfile uses `property_id`, not `id`.
 *  - All nullable scalars in the matching types are `| null`, not `| undefined`.
 *  - `floor` / `total_floors` are non-nullable numbers in the engine type;
 *    Prisma columns are nullable → fall back to 0.
 *  - `orientation: Orientation[]` only accepts 'north'|'south'|'east'|'west';
 *    Prisma stores `String[]` → filter unknown values out.
 *  - `dpe_rating` reuses the engine's literal union; Prisma's enum is
 *    structurally identical so we re-tag the type without runtime work.
 *  - `enriched_at` has no source column yet → always `null`.
 */

import type { Property as PrismaProperty } from '@prisma/client'
import type {
  DpeRating,
  Orientation,
  PropertyProfile,
  PropertyStructuredAttributes,
  PropertySemanticScores,
} from './types'

const ALLOWED_ORIENTATIONS: ReadonlySet<Orientation> = new Set([
  'north',
  'south',
  'east',
  'west',
])

export function toPropertyProfile(p: PrismaProperty): PropertyProfile {
  const structured: PropertyStructuredAttributes = {
    floor: p.floor ?? 0,
    total_floors: p.totalFloors ?? 0,
    has_elevator: p.hasElevator,
    has_terrace: p.hasTerrace,
    terrace_surface_m2: p.terraceSurfaceM2,
    has_balcony: p.hasBalcony,
    balcony_surface_m2: p.balconySurfaceM2,
    has_garden: p.hasGarden,
    garden_surface_m2: p.gardenSurfaceM2,
    has_cellar: p.hasCellar,
    has_parking: p.hasParking,
    has_concierge: p.hasConcierge,
    is_ground_floor: p.isGroundFloor,
    surface_m2: p.surface,
    room_count: p.rooms,
    bedroom_count: p.bedrooms ?? 0,
    bedroom_street_side: p.bedroomStreetSide,
    orientation: p.orientationStructured.filter(
      (o): o is Orientation => ALLOWED_ORIENTATIONS.has(o as Orientation),
    ),
    is_quiet_street: p.isQuietStreet,
    building_year: p.yearBuilt,
    dpe_rating: p.dpe as DpeRating,
  }

  const semantic: PropertySemanticScores = {
    luminosity: p.luminosity,
    quietness: p.quietness,
    charm: p.charm,
    spaciousness: p.spaciousness,
    living_quality: p.livingQuality,
    outdoor_usability: p.outdoorUsability,
  }

  const raw_description = [p.description, p.title, ...p.tags]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ')

  return {
    property_id: p.id,
    structured,
    semantic,
    raw_description,
    enriched_at: null,
  }
}
