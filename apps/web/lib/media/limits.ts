/**
 * Limites des médias — une seule définition pour tout le back-office.
 *
 * LE POIDS EST CALÉ SUR CLOUDINARY, PAS SUR NOUS.
 * Le fichier part du navigateur DIRECTEMENT vers Cloudinary : c'est leur
 * plafond qui fait loi, et il dépend du forfait — 100 Mo par vidéo sur le
 * forfait gratuit, celui de SHOMEE aujourd'hui. On s'arrête à 90 Mo pour
 * garder une marge : un fichier accepté ici DOIT être accepté là-bas. Sinon
 * l'agent attend plusieurs minutes debout dans l'appartement pour se faire
 * refuser à la toute fin — le pire moment possible.
 * Le jour où le forfait passe à Plus (2 Go), seule cette constante bouge.
 *
 * LA DURÉE, ELLE, EST UNE RÈGLE PRODUIT.
 * 80 secondes, c'est le format d'une visite de feed, pas une contrainte
 * technique. C'est pourquoi les deux messages d'erreur ne se ressemblent pas :
 * l'un explique comment alléger le fichier, l'autre pourquoi couper.
 *
 * ET LES DEUX SONT ANNONCÉES D'AVANCE.
 * L'interface ne disait que la durée ; le poids restait invisible jusqu'à
 * l'échec. Une limite qu'on découvre en la dépassant n'est pas une limite,
 * c'est un piège.
 */

export const VIDEO_MAX_BYTES = 90 * 1024 * 1024
export const VIDEO_MAX_DURATION_SEC = 80
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024
export const PLAN_MAX_BYTES = 20 * 1024 * 1024

/** « 48,2 Mo » — même écriture partout, virgule française. */
export function formatMo(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

export const VIDEO_HINT = `MP4, MOV, WEBM · ${VIDEO_MAX_DURATION_SEC} secondes et ${Math.round(VIDEO_MAX_BYTES / 1024 / 1024)} Mo maximum`

/**
 * Un nombre de mégaoctets ne dit pas quoi faire ; un réglage de caméra, si.
 * Le 1080p est environ trois fois plus léger que le 4K et reste la bonne
 * définition pour une vidéo de feed regardée sur un téléphone.
 */
export function messageVideoTropLourde(nom: string, taille: number): string {
  return `${nom} pèse ${formatMo(taille)}, la limite est de ${formatMo(VIDEO_MAX_BYTES)}. Refilmez en 1080p plutôt qu'en 4K : c'est environ trois fois plus léger, et c'est la définition qu'il faut pour le feed.`
}

export function messageVideoTropLongue(secondes: number): string {
  return `Cette vidéo dure ${Math.round(secondes)} secondes, la limite est de ${VIDEO_MAX_DURATION_SEC}. Coupez la fin : au-delà, les acquéreurs décrochent.`
}

export function messageFichierTropLourd(nom: string, taille: number, limite: number): string {
  return `${nom} pèse ${formatMo(taille)}, la limite est de ${formatMo(limite)}.`
}
