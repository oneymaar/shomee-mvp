import type { Agent, Agency, AgentApiKey } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type BearerAuthResult =
  | { ok: true;  apiKey: AgentApiKey; agent: Agent & { agency: Agency } }
  | { ok: false; status: 401; body: { error: string } }

/**
 * Bearer-token auth used by external integrations (LLM imports, MCP server).
 * Resolves the AgentApiKey to the owning Agent + Agency in one query.
 */
export async function authenticateBearer(req: Request): Promise<BearerAuthResult> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, body: { error: 'Clé API invalide' } }
  }
  const key = header.slice(7).trim()
  if (!key) return { ok: false, status: 401, body: { error: 'Clé API invalide' } }

  const apiKey = await prisma.agentApiKey.findUnique({
    where: { key },
    include: { agent: { include: { agency: true } } },
  })
  if (!apiKey) return { ok: false, status: 401, body: { error: 'Clé API invalide' } }

  return { ok: true, apiKey, agent: apiKey.agent }
}
