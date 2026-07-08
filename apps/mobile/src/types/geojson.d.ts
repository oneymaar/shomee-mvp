// Force l'inclusion ambiante de @types/geojson (hoisté à la racine du monorepo).
//
// Les services géo de @shomee/core (geoDataService / geoConstraintService),
// tirés par le handoff deep-link (src/lib/handoff.ts), annotent avec la
// namespace globale `GeoJSON`. L'inclusion automatique des @types ne remonte
// pas jusqu'à la racine depuis apps/mobile ; cette référence la force sans
// restreindre l'allowlist `types` (additive, contrairement à typeRoots/types).
/// <reference types="geojson" />
