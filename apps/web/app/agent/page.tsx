import { redirect } from 'next/navigation'

/**
 * /agent tout court ne menait nulle part (404). Quelqu'un qui tape l'adresse
 * de tête, ou qui remonte d'un cran dans la barre du navigateur, tombe
 * maintenant sur sa liste de biens.
 */
export default function RacineAgent() {
  redirect('/agent/biens')
}
