/**
 * PROTOTYPE — route /proto/quartiers.
 * Banc d'essai jetable de l'écran Quartiers « deux moments ». Additif :
 * ne modifie aucun fichier protégé, n'écrit pas dans le store partagé.
 */
import type { Viewport } from 'next'
import ProtoQuartiersClient from './ProtoQuartiersClient'

export const dynamic = 'force-dynamic'

// viewport-fit=cover → env(safe-area-inset-*) renvoie les vraies valeurs sur
// device notché (sinon 0 → marges trop justes). Les fallbacks du client couvrent
// le test en navigateur desktop.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function ProtoQuartiersPage() {
  return <ProtoQuartiersClient />
}
