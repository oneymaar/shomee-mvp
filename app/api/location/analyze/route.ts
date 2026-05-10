import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `Tu es un assistant de localisation pour SHOMEE, une application immobilière parisienne.

Analyse la demande de localisation de l'utilisateur et retourne uniquement du JSON pur, sans markdown.

Contexte géographique couvert:
- Paris: 20 arrondissements (1er à 20e), cibler "Paris 1", "Paris 11", etc.
- Communes 92 (Hauts-de-Seine): Neuilly-sur-Seine, Boulogne-Billancourt, Levallois-Perret, Puteaux, Courbevoie, Issy-les-Moulineaux, Montrouge, Malakoff, Vanves, Clichy
- Communes 93 (Seine-Saint-Denis): Saint-Denis, Saint-Ouen, Aubervilliers, Pantin, Montreuil, Bagnolet, Les Lilas, Noisy-le-Sec
- Communes 94 (Val-de-Marne): Vincennes, Saint-Mandé, Charenton-le-Pont, Ivry-sur-Seine, Gentilly, Alfortville, Maisons-Alfort

Lignes de métro principales:
- Ligne 1: Château de Vincennes → Vincennes, Nation (12e), Bastille (4/11/12e), Châtelet (1/4e), Louvre (1er), Concorde (8e), Champs-Élysées (8e), La Défense (Puteaux)
- Ligne 2: Nation (11/12e) → Bastille (11e) → Père Lachaise (20e) → Ménilmontant → Belleville (11/19e) → Anvers (18e) → Pigalle (9/18e) → Place de Clichy (8/17e)
- Ligne 4: Montrouge → Alésia (14e) → Montparnasse (15e) → Saint-Germain (6e) → Cité (4e) → Châtelet → Gare du Nord (10e) → Barbès (18e)
- Ligne 6: Nation (12e) → Bercy (12e) → Daumesnil (12e) → Trocadéro (16e) → Montparnasse (15e)
- Ligne 9: Montreuil → Nation (11e) → Oberkampf (11e) → République (3/10/11e) → Opéra (9e) → Saint-Augustin (8e)
- Ligne 13: Châtillon/Montrouge → Malakoff → Montrouge → Alésia (14e) → Montparnasse → Invalides (7e) → Champs-Élysées (8e) → Saint-Lazare (8e) → Clichy → Saint-Denis/Asnières

Règles de décision:
- Arrondissement ou commune cités explicitement → status "clear"
- Ligne de métro ou RER sans secteur précis → status "ambiguous", proposer 2-3 options géographiques
- Description lifestyle vague ("calme", "animé", "proche d'un parc") sans lieu précis → status "too_vague"
- Lieu inconnu ou hors zone → status "not_found"
- Pour "ambiguous" et "too_vague": toujours fournir clarificationOptions avec des query exploitables
- Les query dans clarificationOptions doivent utiliser des termes reconnaissables: "Paris 11", "Vincennes", "Montrouge", etc.`

export async function POST(req: NextRequest) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return NextResponse.json({ error: 'input required' }, { status: 400 })

    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

    const userPrompt = `Demande: "${input.trim()}"

Retourne exactement ce JSON (sans markdown, sans commentaires):
{
  "status": "clear" | "ambiguous" | "too_vague" | "not_found",
  "explicitLocations": [
    { "label": string, "type": "arrondissement" | "commune" | "neighborhood" | "transport_line" | "poi" | "unknown", "confidence": number }
  ],
  "inferredConstraints": [
    { "type": "near_transport" | "near_poi" | "lifestyle" | "exclude_area", "value": string, "confidence": number }
  ],
  "clarificationQuestion": string | null,
  "clarificationOptions": [
    {
      "label": string,
      "description": string,
      "query": string,
      "preselectZones": string[],
      "centerQuery": string
    }
  ] | null,
  "mapAction": {
    "type": "open_map" | "ask_clarification",
    "centerQuery": string | null,
    "preselectQueries": string[]
  }
}

RÈGLES CRITIQUES pour clarificationOptions:
- preselectZones: zones exactes à cocher sur la carte. Formats OBLIGATOIRES:
  * Arrondissements: "Paris 1", "Paris 4", "Paris 11", "Paris 18" (chiffre seul, sans "e"/"er")
  * Communes limitrophes: "Vincennes", "Montrouge", "Neuilly-sur-Seine", "Saint-Mandé", "Montreuil", etc.
  * Géographiquement correct: si label="Châtelet", preselectZones=["Paris 1","Paris 4"] — jamais ["Paris 14"]
  * Si label="Montmartre", preselectZones=["Paris 18"] — Montmartre est dans le 18e
  * Si label="Bastille", preselectZones=["Paris 4","Paris 11","Paris 12"]
- centerQuery: cible de géocodage pour centrer la carte. Ex: "Châtelet-Les Halles, Paris", "Montmartre, Paris", "Vincennes"`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Anthropic error:', err)
      return NextResponse.json({ error: 'upstream error' }, { status: 500 })
    }

    const data = await res.json()
    const text: string = data.content?.[0]?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return NextResponse.json({ error: 'no JSON in response' }, { status: 500 })

    const analysis = JSON.parse(match[0])
    return NextResponse.json(analysis)
  } catch (e) {
    console.error('Location analyze route error:', e)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
