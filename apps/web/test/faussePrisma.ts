// Module substitué à @/lib/prisma par vitest (voir vitest.config.ts).
import { base } from './doublePrisma.ts'
export const prisma = base as unknown as typeof import('@/lib/prisma').prisma
