/**
 * Révoquer une clé d'API agent.
 *
 * Écrit pour retirer `shomee_test_kr3tz_0001`, qui a vécu en dur dans du code
 * CLIENT : elle partait dans le JavaScript de tous les navigateurs ouvrant le
 * back-office, donc elle est à considérer comme publique. La révoquer coupe
 * l'accès immédiatement, partout — API, connecteur, tout ce qui la présente.
 *
 * Le script montre d'abord à QUI appartient la clé et ce qu'elle a servi, puis
 * supprime, puis liste ce qui reste au même agent. Supprimer un secret sans
 * regarder ce qu'on casse est le meilleur moyen de couper autre chose.
 *
 *   cd /Users/oliviermenart/shomee-mvp/apps/web
 *   npm run cle:revoquer -- shomee_test_kr3tz_0001
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

function dateFr(d: Date | null): string {
  return d ? d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }) : 'jamais'
}

async function main() {
  const cible = process.argv[2]
  if (!cible) {
    console.error('Indiquez la clé à révoquer.\n  npm run cle:revoquer -- shomee_test_kr3tz_0001')
    process.exit(1)
  }

  const cle = await prisma.agentApiKey.findUnique({
    where: { key: cible },
    include: { agent: { include: { agency: true } } },
  })

  if (!cle) {
    console.log(`Aucune clé « ${cible} » en base — rien à révoquer.`)
    return
  }

  console.log('\nClé trouvée :')
  console.log(`  libellé            ${cle.label}`)
  console.log(`  agent              ${cle.agent.name} (${cle.agent.email})`)
  console.log(`  agence             ${cle.agent.agency.name}`)
  console.log(`  créée le           ${dateFr(cle.createdAt)}`)
  console.log(`  dernière utilisation ${dateFr(cle.lastUsed)}`)

  await prisma.agentApiKey.delete({ where: { id: cle.id } })
  console.log('\n✓ Clé révoquée. Toute requête qui la présente reçoit désormais un refus.')

  const restantes = await prisma.agentApiKey.findMany({
    where: { agentId: cle.agentId },
    orderBy: { createdAt: 'desc' },
    select: { label: true, key: true, lastUsed: true },
  })
  if (restantes.length === 0) {
    console.log(`\n⚠ ${cle.agent.name} n'a plus aucune clé. Pour rebrancher Claude ou ChatGPT :`)
    console.log('  back-office → Paramètres → « Créer mon connecteur ».')
  } else {
    console.log(`\nIl reste ${restantes.length} clé(s) à ${cle.agent.name} :`)
    for (const r of restantes) {
      console.log(`  ${r.label.padEnd(18)} ${r.key.slice(0, 8)}…${r.key.slice(-4)}  (utilisée : ${dateFr(r.lastUsed)})`)
    }
  }
}

main()
  .catch((e) => { console.error('\nÉchec :', e instanceof Error ? e.message : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
