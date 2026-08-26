import { redirect } from 'next/navigation'

/**
 * L'écran vivait ici, mais la barre de navigation du back-office pointe sur
 * « Paramètres » → /agent/parametres : personne ne pouvait donc l'atteindre
 * autrement qu'en connaissant l'URL. La page a déménagé sous le nom que
 * l'interface annonce ; cette redirection garde les anciens liens valides.
 */
export default function AncienneUrlReglages() {
  redirect('/agent/parametres')
}
