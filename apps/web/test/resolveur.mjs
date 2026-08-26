/**
 * Résolveur de modules pour le banc d'essai.
 *
 * Node ne connaît ni l'alias « @/ » de Next, ni le paquet d'espace de travail
 * @shomee/core, et il refuse de retirer les types d'un fichier .ts situé sous
 * node_modules. Ces trois obstacles se lèvent avec un crochet de résolution —
 * beaucoup plus léger qu'un empaqueteur, et sans binaire natif : le banc doit
 * pouvoir tourner partout, y compris hors ligne.
 *
 * Il fait aussi LE remplacement qui compte : « @/lib/prisma » pointe vers le
 * double en mémoire. Tout le reste — handlers, protocole, outils — est le vrai
 * code de production.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORE = path.resolve(RACINE, '../../packages/core/src')

function fichier(base) {
  for (const candidat of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidat) && fs.statSync(candidat).isFile()) return candidat
  }
  return null
}

export async function resolve(specifier, context, next) {
  // Un chemin relatif sans extension vers un .ts voisin : Node l'exige
  // explicite, on le complète plutôt que d'alourdir chaque import.
  if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    const trouve = fichier(base)
    if (trouve) return { url: pathToFileURL(trouve).href, shortCircuit: true }
  }
  let cible = null
  if (specifier === '@/lib/prisma') cible = fichier(path.join(RACINE, 'test/faussePrisma'))
  else if (specifier.startsWith('@/')) cible = fichier(path.join(RACINE, specifier.slice(2)))
  else if (specifier === '@shomee/core') cible = fichier(path.join(CORE, 'index'))
  else if (specifier.startsWith('@shomee/core/')) cible = fichier(path.join(CORE, specifier.slice('@shomee/core/'.length)))
  // On ne force PAS `format` : c'est Node qui doit reconnaître le .ts et en
  // retirer les types. Annoncer « module » court-circuiterait ce traitement.
  if (cible) return { url: pathToFileURL(cible).href, shortCircuit: true }
  return next(specifier, context)
}
