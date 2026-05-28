import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Clé API invalide' }, { status: 401 })
  }
  const key = header.slice(7).trim()
  if (!key) return NextResponse.json({ error: 'Clé API invalide' }, { status: 401 })

  const callingKey = await prisma.agentApiKey.findUnique({
    where: { key },
    select: { agentId: true },
  })
  if (!callingKey) return NextResponse.json({ error: 'Clé API invalide' }, { status: 401 })

  const keys = await prisma.agentApiKey.findMany({
    where: { agentId: callingKey.agentId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      label: true,
      key: true,
      createdAt: true,
      lastUsed: true,
    },
  })

  return NextResponse.json({ keys })
}
