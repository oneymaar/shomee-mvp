import { NextRequest, NextResponse } from 'next/server'

// Parse free-text French property preferences into structured positive
// (criteria the user wants) and negative (criteria the user excludes) items.
// Returned shape is intentionally minimal: { criteria: [{label, type}] }.
const SYSTEM_PROMPT = `Tu es un assistant qui transforme des préférences immobilières en français en critères structurés.

Règles strictes :
- Tu reçois une phrase ou plusieurs critères énoncés librement par un utilisateur.
- Tu extrais chaque critère distinct et le classes en POSITIF (ce que l'utilisateur veut) ou NÉGATIF (ce qu'il refuse).
- Tu réécris chaque critère en une formulation très courte, claire, immédiatement lisible (4 à 8 mots max).
- Tu gardes le ton humain, sans jargon immobilier.
- Tu ne gardes que des critères concrets liés au logement ou à l'immeuble. Tu ignores le budget, la localisation, le type de bien (appartement/maison), la surface, le nombre de pièces (ces critères sont collectés ailleurs).
- Si la phrase contient plusieurs critères, tu les sépares.

Marqueurs typiques de négatif : "pas", "sans", "éviter", "ne veut pas", "ne souhaite pas", "non", "hors", "exclure".

Exemples :
Entrée : "ascenseur indispensable à partir du 3e"
Sortie : [{"label":"Ascenseur obligatoire à partir du 3e","type":"positive"}]

Entrée : "terrasse orientée sud, pas de chambre sur rue"
Sortie : [
  {"label":"Terrasse orientée sud","type":"positive"},
  {"label":"Pas de chambre sur rue","type":"negative"}
]

Entrée : "salon lumineux, cuisine où on peut recevoir, éviter le rez-de-chaussée"
Sortie : [
  {"label":"Salon lumineux","type":"positive"},
  {"label":"Cuisine conviviale","type":"positive"},
  {"label":"Pas de rez-de-chaussée","type":"negative"}
]

Entrée : "vue dégagée et calme, sans vis-à-vis"
Sortie : [
  {"label":"Vue dégagée","type":"positive"},
  {"label":"Logement calme","type":"positive"},
  {"label":"Sans vis-à-vis","type":"negative"}
]

FORMAT DE SORTIE OBLIGATOIRE :
Retourner UNIQUEMENT du JSON pur, sans markdown, sans commentaires.
{
  "criteria": [
    { "label": "string court et lisible", "type": "positive" | "negative" }
  ]
}

Si rien d'exploitable : retourne { "criteria": [] }.`

export async function POST(req: NextRequest) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return NextResponse.json({ error: 'input required' }, { status: 400 })

    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Texte: "${input.trim()}"\n\nRetourne le JSON.` }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[criteria/analyze] upstream:', err)
      return NextResponse.json({ error: 'upstream error' }, { status: 500 })
    }

    const data = await res.json()
    const text: string = data.content?.[0]?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      console.error('[criteria/analyze] no JSON in response:', text.slice(0, 300))
      return NextResponse.json({ criteria: [] })
    }

    let parsed: { criteria?: Array<{ label?: string; type?: string }> }
    try {
      parsed = JSON.parse(match[0])
    } catch (e) {
      console.error('[criteria/analyze] JSON.parse failed:', e)
      return NextResponse.json({ criteria: [] })
    }

    const criteria = Array.isArray(parsed.criteria)
      ? parsed.criteria
          .filter(
            (c): c is { label: string; type: 'positive' | 'negative' } =>
              !!c &&
              typeof c.label === 'string' &&
              c.label.trim().length > 0 &&
              (c.type === 'positive' || c.type === 'negative'),
          )
          .map((c) => ({ label: c.label.trim(), type: c.type }))
      : []

    return NextResponse.json({ criteria })
  } catch (e) {
    console.error('[criteria/analyze] error:', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
