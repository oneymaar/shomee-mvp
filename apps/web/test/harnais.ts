/**
 * Mini-harnais de test — trois fonctions, aucun binaire natif, aucune
 * installation. Vitest s'appuie sur un binaire compilé par plateforme : le
 * dépôt étant partagé entre plusieurs machines, ce banc doit rester exécutable
 * partout avec le seul Node.
 */
type Etape = { titre: string; corps: () => void | Promise<void> }

const groupes: Array<{ titre: string; etapes: Etape[] }> = []
const avantTout: Array<() => void | Promise<void>> = []
let courant: { titre: string; etapes: Etape[] } | null = null

export function avant(corps: () => void | Promise<void>): void {
  avantTout.push(corps)
}

export function describe(titre: string, corps: () => void): void {
  courant = { titre, etapes: [] }
  groupes.push(courant)
  corps()
  courant = null
}

export function it(titre: string, corps: () => void | Promise<void>): void {
  if (!courant) throw new Error('it() hors de describe()')
  courant.etapes.push({ titre, corps })
}

class EchecAssertion extends Error {}

function decrire(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.length > 160 ? `${v.slice(0, 160)}…` : v)
  if (v instanceof Date) return v.toISOString()
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function expect(recu: unknown) {
  const echec = (attendu: string): never => {
    throw new EchecAssertion(`attendu ${attendu}, reçu ${decrire(recu)}`)
  }
  const api = {
    toBe(attendu: unknown) {
      if (recu !== attendu) echec(decrire(attendu))
    },
    toEqual(attendu: unknown) {
      if (JSON.stringify(recu) !== JSON.stringify(attendu)) echec(decrire(attendu))
    },
    toContain(morceau: string) {
      if (typeof recu === 'string' ? !recu.includes(morceau) : !(recu as unknown[]).includes(morceau)) {
        echec(`contenir ${decrire(morceau)}`)
      }
    },
    toMatch(motif: RegExp) {
      if (!motif.test(String(recu))) echec(`correspondre à ${motif}`)
    },
    toHaveLength(n: number) {
      if ((recu as unknown[]).length !== n) echec(`une longueur de ${n} (reçu ${(recu as unknown[]).length})`)
    },
    toBeNull() {
      if (recu !== null) echec('null')
    },
    toBeInstanceOf(classe: unknown) {
      if (!(recu instanceof (classe as new () => unknown))) echec(`une instance de ${(classe as { name: string }).name}`)
    },
    toContainTous(morceaux: string[]) {
      const liste = recu as string[]
      const manquants = morceaux.filter((m) => !liste.includes(m))
      if (manquants.length) echec(`contenir ${decrire(manquants)}`)
    },
    get not() {
      return {
        toBe: (a: unknown) => { if (recu === a) echec(`différent de ${decrire(a)}`) },
        toContain: (m: string) => {
          const dedans = typeof recu === 'string' ? recu.includes(m) : (recu as unknown[]).includes(m)
          if (dedans) echec(`ne PAS contenir ${decrire(m)}`)
        },
      }
    },
  }
  return api
}

export async function executer(): Promise<void> {
  for (const c of avantTout) await c()
  let verts = 0
  const rouges: string[] = []
  for (const groupe of groupes) {
    console.log(`\n  ${groupe.titre}`)
    for (const etape of groupe.etapes) {
      try {
        await etape.corps()
        verts++
        console.log(`    \x1b[32m✓\x1b[0m ${etape.titre}`)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        rouges.push(`${groupe.titre} › ${etape.titre}\n      ${message}`)
        console.log(`    \x1b[31m✗\x1b[0m ${etape.titre}\n      \x1b[31m${message}\x1b[0m`)
      }
    }
  }
  console.log(
    rouges.length === 0
      ? `\n\x1b[32m${verts} vérifications, toutes vertes.\x1b[0m\n`
      : `\n\x1b[31m${rouges.length} échec(s) sur ${verts + rouges.length}.\x1b[0m\n`,
  )
  process.exit(rouges.length === 0 ? 0 : 1)
}
