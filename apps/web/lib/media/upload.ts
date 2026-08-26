/**
 * Le téléversement d'un média, en vrai.
 *
 * Sorti de MediaUploader pour être partagé avec l'assistant « Nouveau bien ».
 * L'assistant en avait une version SIMULÉE — un setInterval de deux secondes
 * qui remplissait une barre sans qu'aucun octet ne parte. Deux implémentations
 * du même geste, dont une fausse : c'est exactement ce qu'on ne refait pas.
 *
 * Trois temps, dont aucun n'est facultatif :
 *   1. signature côté SHOMEE (l'agent est identifié par son cookie de session) ;
 *   2. envoi DIRECT du navigateur vers Cloudinary, en XHR pour avoir la
 *      progression réelle — fetch() ne sait pas remonter l'avancement d'un
 *      corps de requête ;
 *   3. confirmation côté SHOMEE, qui persiste l'URL et recalcule la complétude.
 *
 * Sans le temps 3, la vidéo existe chez Cloudinary et le bien l'ignore.
 */
import {
  VIDEO_MAX_BYTES, PHOTO_MAX_BYTES, PLAN_MAX_BYTES, VIDEO_MAX_DURATION_SEC,
  messageVideoTropLourde, messageVideoTropLongue, messageFichierTropLourd,
} from './limits'

export type MediaType = 'video' | 'photo' | 'plan' | 'visite_virtuelle'

export const TAILLE_MAX: Record<MediaType, number> = {
  video: VIDEO_MAX_BYTES,
  photo: PHOTO_MAX_BYTES,
  plan: PLAN_MAX_BYTES,
  visite_virtuelle: 0,
}

export const ACCEPT: Record<MediaType, string> = {
  video: 'video/mp4,video/quicktime,video/webm',
  photo: 'image/jpeg,image/png,image/webp',
  plan: 'image/jpeg,image/png,application/pdf',
  visite_virtuelle: '',
}

const RESOURCE_TYPE: Record<MediaType, 'video' | 'image' | 'raw'> = {
  video: 'video', photo: 'image', plan: 'image', visite_virtuelle: 'image',
}

const FOLDER: Record<MediaType, string> = {
  video: 'shomee/videos', photo: 'shomee/photos', plan: 'shomee/plans', visite_virtuelle: 'shomee/misc',
}

/** Durée réelle du fichier, lue par le navigateur avant tout envoi. */
export function sonderDureeVideo(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    const nettoyer = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : null
      nettoyer()
      resolve(d)
    }
    video.onerror = () => { nettoyer(); resolve(null) }
    video.src = url
  })
}

/**
 * Contrôles AVANT le premier octet envoyé. Refuser après trois minutes
 * d'attente serait la pire façon de dire non.
 */
export async function verifierFichier(file: File, type: MediaType): Promise<void> {
  const limite = TAILLE_MAX[type]
  if (limite > 0 && file.size > limite) {
    throw new Error(
      type === 'video'
        ? messageVideoTropLourde(file.name, file.size)
        : messageFichierTropLourd(file.name, file.size, limite),
    )
  }
  if (type === 'video') {
    const duree = await sonderDureeVideo(file)
    if (duree !== null && duree > VIDEO_MAX_DURATION_SEC) throw new Error(messageVideoTropLongue(duree))
  }
}

interface SignResponse {
  signature: string
  timestamp: number
  cloud_name: string
  api_key: string
  folder: string
  eager?: string
  eager_async?: string
  upload_preset?: string
}

export interface ResultatTeleversement {
  url: string
  publicId: string
  completionRate: number | null
}

export interface OptionsTeleversement {
  file: File
  type: MediaType
  bienId: string
  /** Progression réelle, 0 à 100. */
  onProgress?: (pourcent: number, octetsEnvoyes: number) => void
  /** Permet à l'agent d'annuler un envoi en cours. */
  signal?: AbortSignal
}

export async function televerser(opts: OptionsTeleversement): Promise<ResultatTeleversement> {
  const { file, type, bienId, onProgress, signal } = opts
  await verifierFichier(file, type)

  // 1. Signature
  const signRes = await fetch('/api/upload/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: FOLDER[type] }),
  })
  if (!signRes.ok) {
    const corps = (await signRes.json().catch(() => null)) as { error?: string } | null
    throw new Error(corps?.error ?? `Signature refusée (HTTP ${signRes.status}).`)
  }
  const sig = (await signRes.json()) as SignResponse

  // 2. Envoi direct vers Cloudinary — XHR pour la progression réelle.
  const cloud = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('api_key', sig.api_key)
    form.append('timestamp', String(sig.timestamp))
    form.append('signature', sig.signature)
    form.append('folder', sig.folder)
    if (sig.eager) form.append('eager', sig.eager)
    if (sig.eager_async) form.append('eager_async', sig.eager_async)
    if (sig.upload_preset) form.append('upload_preset', sig.upload_preset)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloud_name}/${RESOURCE_TYPE[type]}/upload`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100), e.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)) }
        catch { reject(new Error('Réponse Cloudinary illisible.')) }
        return
      }
      // Cloudinary refuse au-delà du plafond du forfait : on le dit en clair
      // plutôt que de recracher un code HTTP.
      if (xhr.status === 400 && /file size|too large/i.test(xhr.responseText)) {
        reject(new Error(messageVideoTropLourde(file.name, file.size)))
        return
      }
      reject(new Error(`Cloudinary a refusé l'envoi (HTTP ${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('Connexion interrompue pendant l\'envoi.'))
    xhr.ontimeout = () => reject(new Error('L\'envoi a expiré.'))
    xhr.onabort = () => reject(new DOMException('Envoi annulé.', 'AbortError'))
    if (signal) {
      if (signal.aborted) { xhr.abort(); return }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(form)
  })

  // 3. Confirmation — sans elle, le fichier existe chez Cloudinary et le bien
  //    n'en sait rien.
  const confirmRes = await fetch('/api/upload/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bien_id: bienId, type, url: cloud.secure_url, public_id: cloud.public_id }),
  })
  if (!confirmRes.ok) {
    const corps = (await confirmRes.json().catch(() => null)) as { error?: string } | null
    throw new Error(corps?.error ?? `Enregistrement refusé (HTTP ${confirmRes.status}).`)
  }
  const confirme = (await confirmRes.json()) as { completion_rate?: number }

  return {
    url: cloud.secure_url,
    publicId: cloud.public_id,
    completionRate: typeof confirme.completion_rate === 'number' ? confirme.completion_rate : null,
  }
}
