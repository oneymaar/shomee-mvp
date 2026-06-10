import { readFileSync } from 'node:fs'
const env = readFileSync('.env', 'utf8')
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const p = new PrismaClient({ adapter })
const r = await p.property.findUnique({
  where: { id: 'cmppap4110007co28ajuvv677' },
  select: { agencyId: true, createdByAgentId: true, agentName: true, agentAvatar: true, videoUrl: true, imageUrlFallback: true },
})
console.log(JSON.stringify(r, null, 2))
await p.$disconnect()
