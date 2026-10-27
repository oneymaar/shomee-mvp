/**
 * Zone dessinée au doigt → îlots IRIS (option A, décidée le 27/10/2026).
 *
 * Le moteur de recherche ne connaît que des IRIS : la zone dessinée est donc
 * traduite en la liste des IRIS qu'elle couvre, et c'est cette liste — pas le
 * tracé — qui part dans la recherche. Le tracé reste affiché pour l'acquéreur.
 *
 * Règle d'appartenance d'un IRIS :
 *   - son centre tombe dans la zone dessinée, OU
 *   - plus de la moitié de son contour est dans la zone dessinée ;
 *   - et si la zone est si petite qu'aucun IRIS ne passe ces tests, on prend
 *     l'IRIS qui contient le centre de la zone (un petit rond dans un îlot
 *     sélectionne cet îlot, il ne donne jamais « rien »).
 */
import type { GeoZone } from '@shomee/core/geo/geoDataService'

/** Point [lng, lat] — ordre GeoJSON. */
type Pt = [number, number]

function inRing(p: Pt, ring: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Anneaux extérieurs + trous d'une géométrie IRIS. */
function polygonsOf(g: GeoJSON.Geometry | null | undefined): Pt[][][] {
  if (!g) return []
  if (g.type === 'Polygon') return [g.coordinates as Pt[][]]
  if (g.type === 'MultiPolygon') return g.coordinates as Pt[][][]
  return []
}

function inGeometry(p: Pt, polys: Pt[][][]): boolean {
  for (const rings of polys) {
    if (!rings[0] || !inRing(p, rings[0])) continue
    let inHole = false
    for (let h = 1; h < rings.length; h++) if (inRing(p, rings[h])) { inHole = true; break }
    if (!inHole) return true
  }
  return false
}

/** Centre de gravité (surface) du plus grand anneau extérieur. */
function areaCentroid(polys: Pt[][][]): Pt | null {
  let best: Pt[] | null = null
  let bestArea = 0
  for (const rings of polys) {
    const r = rings[0]
    if (!r) continue
    let a = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
    if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = r }
  }
  if (!best || bestArea === 0) return null
  let a = 0, cx = 0, cy = 0
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1]
    a += f
    cx += (best[j][0] + best[i][0]) * f
    cy += (best[j][1] + best[i][1]) * f
  }
  return [cx / (3 * a), cy / (3 * a)]
}

function bbox(pts: Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return [x0, y0, x1, y1]
}

/**
 * @param lasso tracé fermé, en [lat, lng] (ordre Leaflet)
 * @param iris  tous les IRIS chargés (Paris + petite couronne)
 * @returns ids des IRIS retenus
 */
export function lassoToIris(lasso: [number, number][], iris: GeoZone[]): string[] {
  if (lasso.length < 3) return []
  const ring: Pt[] = lasso.map(([lat, lng]) => [lng, lat])
  const [lx0, ly0, lx1, ly1] = bbox(ring)
  const out: string[] = []

  for (const z of iris) {
    const polys = polygonsOf(z.feature?.geometry)
    if (polys.length === 0) continue
    const outer = polys.flatMap((p) => p[0] ?? [])
    const [x0, y0, x1, y1] = bbox(outer)
    if (x1 < lx0 || x0 > lx1 || y1 < ly0 || y0 > ly1) continue // aucun recouvrement possible

    const c = areaCentroid(polys)
    if (c && inRing(c, ring)) { out.push(z.id); continue }

    let n = 0
    for (const p of outer) if (inRing(p, ring)) n++
    if (outer.length > 0 && n / outer.length > 0.5) out.push(z.id)
  }

  if (out.length === 0) {
    // Petit rond à l'intérieur d'un seul îlot : on prend cet îlot.
    const centre = areaCentroid([[ring]]) ?? ring[0]
    const hit = iris.find((z) => inGeometry(centre, polygonsOf(z.feature?.geometry)))
    if (hit) out.push(hit.id)
  }
  return out
}
