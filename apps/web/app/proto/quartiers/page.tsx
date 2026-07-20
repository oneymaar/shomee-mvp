/**
 * PROTOTYPE — route /proto/quartiers.
 * Banc d'essai jetable de l'écran Quartiers « deux moments ». Additif :
 * ne modifie aucun fichier protégé, n'écrit pas dans le store partagé.
 */
import ProtoQuartiersClient from './ProtoQuartiersClient'

export const dynamic = 'force-dynamic'

export default function ProtoQuartiersPage() {
  return <ProtoQuartiersClient />
}
