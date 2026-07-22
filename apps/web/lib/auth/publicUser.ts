import type { User } from '@prisma/client'

/** Vue publique d'un User renvoyee au client (jamais les subs fournisseurs). */
export interface PublicUser {
  id: string
  email: string | null
  name: string | null
  avatar: string | null
  role: string
  isGuest: boolean
}

export function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    role: u.role,
    isGuest: u.isGuest,
  }
}
