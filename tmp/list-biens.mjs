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
const rs = await p.property.findMany({
  where: { videoUrl: { startsWith: 'https://res.cloudinary.com' } },
  select: { id: true, title: true, rooms: true, bedrooms: true, composition: true, description: true, location: true },
})
for (const r of rs) {
  const comp = Array.isArray(r.composition) ? r.composition.length : 0
  const descLen = r.description ? r.description.length : 0
  console.log(JSON.stringify({
    id: r.id,
    title: r.title?.slice(0, 50),
    location: r.location?.slice(0, 40),
    rooms: r.rooms,
    bedrooms: r.bedrooms,
    composition: comp,
    descChars: descLen,
  }))
}
await p.$disconnect()
