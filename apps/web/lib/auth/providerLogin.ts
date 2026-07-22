import type { User } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { signSession } from './jwt'
import { publicUser, type PublicUser } from './publicUser'

export type Provider = 'apple' | 'google'

interface ProviderLoginInput {
  provider: Provider
  sub: string
  email?: string | null
  name?: string | null
  deviceId?: string
}

export interface LoginResult {
  token: string
  user: PublicUser
}

async function resolveUser(input: ProviderLoginInput): Promise<User> {
  const { provider, sub, email, name, deviceId } = input
  const providerWhere = provider === 'apple' ? { appleSub: sub } : { googleSub: sub }
  const providerData = provider === 'apple' ? { appleSub: sub } : { googleSub: sub }

  // 1) Fournisseur deja connu.
  const byProvider = await prisma.user.findFirst({ where: providerWhere })
  if (byProvider) {
    return prisma.user.update({
      where: { id: byProvider.id },
      data: {
        lastSeenAt: new Date(),
        ...(email && !byProvider.email ? { email } : {}),
        ...(name && !byProvider.name ? { name } : {}),
      },
    })
  }

  // 2) Meme email → on rattache le fournisseur a ce compte (lie Apple + Google).
  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email } })
    if (byEmail) {
      return prisma.user.update({
        where: { id: byEmail.id },
        data: { ...providerData, isGuest: false, lastSeenAt: new Date(), ...(name && !byEmail.name ? { name } : {}) },
      })
    }
  }

  // 3) Device rattache a un invite → upgrade de cet invite.
  if (deviceId) {
    const dev = await prisma.userDevice.findUnique({ where: { deviceId }, include: { user: true } })
    if (dev?.user && dev.user.isGuest) {
      return prisma.user.update({
        where: { id: dev.user.id },
        data: { ...providerData, isGuest: false, lastSeenAt: new Date(), ...(email ? { email } : {}), ...(name ? { name } : {}) },
      })
    }
  }

  // 4) Nouveau compte.
  return prisma.user.create({
    data: { role: 'BUYER', isGuest: false, ...providerData, ...(email ? { email } : {}), ...(name ? { name } : {}) },
  })
}

async function linkDevice(userId: string, deviceId?: string): Promise<void> {
  if (!deviceId) return
  await prisma.userDevice.upsert({
    where: { deviceId },
    update: { userId },
    create: { deviceId, userId },
  })
}

export async function providerLogin(input: ProviderLoginInput): Promise<LoginResult | null> {
  const user = await resolveUser(input)
  await linkDevice(user.id, input.deviceId)
  const token = signSession(user.id, user.isGuest)
  if (!token) return null
  return { token, user: publicUser(user) }
}
