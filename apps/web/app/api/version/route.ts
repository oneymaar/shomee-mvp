import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * La version actuellement servie. Sert au bandeau « nouvelle version ».
 *
 * Pourquoi c'est nécessaire : une application Next navigue côté client. Une
 * fois la page chargée, le navigateur garde SON bundle JavaScript pour toute
 * la session — un déploiement peut passer sans que rien ne change à l'écran.
 * On a perdu une soirée là-dessus : le correctif était en ligne, l'écran
 * montrait toujours l'ancien code, et tout laissait croire que le correctif
 * n'avait pas marché.
 */
export async function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
