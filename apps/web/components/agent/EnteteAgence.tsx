import Link from 'next/link'
import { ChevronRight, MessageCircle } from 'lucide-react'
import { couleurs, SERIF } from '@/lib/theme'
import type { Notifications } from '@/lib/agent/notifications'

/**
 * L'en-tête des écrans du back-office — une seule écriture, partagée.
 *
 * Ce qu'il n'a plus : les raccourcis « Messages » et « Réglages ». Ils
 * doublonnaient la barre d'onglets du bas, et c'est ce qui étranglait la
 * hauteur du bloc — le nom de l'agent passait sur deux lignes et l'ensemble
 * remontait sous l'îlot dynamique. Une destination = un seul chemin.
 */

const PLANS: Record<string, string> = {
  BASIC: 'Basic',
  PRO: 'Pro',
  PREMIUM: 'Premium',
}

export function EnteteAgence({
  agence,
  logo,
  plan,
  agent,
  dessous,
  surtitre = 'Espace agence',
}: {
  agence: string
  logo: string | null
  plan: string
  agent: string
  /** Ligne de contexte sous le nom (quota, période observée…). */
  dessous?: string
  surtitre?: string
}) {
  const initiales = agence
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <header className="flex items-center gap-3.5 mb-6">
      {/* Logo agence ROND — consigne de direction artistique du 20/08. */}
      <div
        className="flex-none rounded-full overflow-hidden flex items-center justify-center"
        style={{
          width: 52,
          height: 52,
          backgroundColor: couleurs.carte,
          border: `1px solid ${couleurs.ligne}`,
        }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={agence} className="w-full h-full object-contain p-1.5" />
        ) : (
          <span style={{ fontFamily: SERIF, fontSize: 19, color: couleurs.terracotta }}>
            {initiales}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p
          className="text-[10px] font-bold uppercase"
          style={{ color: couleurs.terracotta, letterSpacing: '1.8px' }}
        >
          {surtitre}
        </p>
        <h1
          className="truncate leading-[1.15] mt-0.5"
          style={{ fontFamily: SERIF, fontSize: 24, color: couleurs.encre }}
        >
          {agence}
        </h1>
        <p className="text-[12px] truncate mt-1" style={{ color: couleurs.doux }}>
          {agent} · forfait {PLANS[plan] ?? plan}
          {dessous ? ` · ${dessous}` : ''}
        </p>
      </div>
    </header>
  )
}

/**
 * La pastille de notification, en clair.
 *
 * Un compteur seul ne dit pas quoi faire. Celui-ci nomme les deux choses qui
 * méritent qu'on s'arrête : des messages non lus, et — bien plus urgent — des
 * acquéreurs qui ont donné leurs disponibilités et attendent un créneau.
 * Terracotta parce que c'est une ACTION, pas une décoration.
 */
export function BandeauNotifications({ notif }: { notif: Notifications }) {
  if (notif.messages === 0 && notif.aCaler === 0) return null

  const titre =
    notif.messages > 0
      ? `${notif.messages} message${notif.messages > 1 ? 's' : ''} non lu${notif.messages > 1 ? 's' : ''}`
      : `${notif.aCaler} visite${notif.aCaler > 1 ? 's' : ''} à caler`

  const detail =
    notif.messages > 0 && notif.aCaler > 0
      ? `dont ${notif.aCaler} visite${notif.aCaler > 1 ? 's' : ''} à caler`
      : notif.messages > 0
        ? `sur ${notif.fils} conversation${notif.fils > 1 ? 's' : ''}`
        : 'l’acquéreur a donné ses disponibilités'

  return (
    <Link
      href="/agent/messages"
      className="flex items-center gap-3 rounded-2xl px-4 py-3.5 mb-5 active:opacity-80 transition-opacity"
      style={{ backgroundColor: couleurs.carte, border: `1.5px solid ${couleurs.terracotta}` }}
    >
      <span
        className="flex-none rounded-full flex items-center justify-center"
        style={{ width: 34, height: 34, backgroundColor: couleurs.terracotta }}
      >
        <MessageCircle size={17} color={couleurs.cremeSurSombre} strokeWidth={2} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-semibold" style={{ color: couleurs.encre }}>
          {titre}
        </span>
        <span className="block text-[12px] truncate" style={{ color: couleurs.doux }}>
          {detail}
        </span>
      </span>
      <ChevronRight size={18} color={couleurs.terracotta} className="flex-none" />
    </Link>
  )
}

/** Une tuile de chiffre — libellé en petites capitales, nombre en serif. */
export function Tuile({
  libelle,
  valeur,
  accent = false,
}: {
  libelle: string
  valeur: string | number
  accent?: boolean
}) {
  return (
    <div
      className="rounded-2xl px-3.5 py-3"
      style={{ backgroundColor: couleurs.carte, border: `1px solid ${couleurs.ligne}` }}
    >
      <p
        className="text-[9.5px] font-bold uppercase"
        style={{ color: couleurs.estompe, letterSpacing: '1.2px' }}
      >
        {libelle}
      </p>
      <p
        className="leading-none mt-1.5"
        style={{
          fontFamily: SERIF,
          fontSize: 26,
          color: accent ? couleurs.terracotta : couleurs.encre,
        }}
      >
        {valeur}
      </p>
    </div>
  )
}
