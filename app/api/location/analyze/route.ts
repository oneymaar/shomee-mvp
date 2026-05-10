import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `Tu es un assistant de localisation pour SHOMEE, une application immobilière parisienne.

Analyse la demande de localisation de l'utilisateur et retourne uniquement du JSON pur, sans markdown.

Contexte géographique couvert:
- Paris: 20 arrondissements (1er à 20e), cibler "Paris 1", "Paris 11", etc.
- Communes 92 (Hauts-de-Seine): Neuilly-sur-Seine, Boulogne-Billancourt, Levallois-Perret, Puteaux, Courbevoie, Issy-les-Moulineaux, Montrouge, Malakoff, Vanves, Clichy
- Communes 93 (Seine-Saint-Denis): Saint-Denis, Saint-Ouen, Aubervilliers, Pantin, Montreuil, Bagnolet, Les Lilas, Noisy-le-Sec
- Communes 94 (Val-de-Marne): Vincennes, Saint-Mandé, Charenton-le-Pont, Ivry-sur-Seine, Gentilly, Alfortville, Maisons-Alfort

Quartiers parisiens reconnus et leur traduction en arrondissements (utiliser pour preselectZones/preselectQueries):
- Le Marais → Paris 3, Paris 4
- Montmartre → Paris 18
- Bastille → Paris 4, Paris 11, Paris 12
- Belleville → Paris 11, Paris 19, Paris 20
- Pigalle → Paris 9, Paris 18
- Oberkampf → Paris 11
- Nation → Paris 11, Paris 12
- Daumesnil → Paris 12
- Bercy → Paris 12
- Saint-Germain-des-Prés → Paris 6
- Châtelet / Les Halles → Paris 1, Paris 4
- Canal Saint-Martin → Paris 10
- Montparnasse → Paris 14, Paris 15
- Trocadéro → Paris 16
- Invalides → Paris 7
- Buttes-Chaumont → Paris 19
- La Villette → Paris 19
- Passy → Paris 16
- Auteuil → Paris 16
- Batignolles → Paris 17
- Gare du Nord → Paris 10
- Gare de Lyon → Paris 12
- Opéra → Paris 9
- Madeleine → Paris 8
- Place d'Italie → Paris 13
- Alésia → Paris 14
- Père-Lachaise → Paris 20
- Champs-Élysées → Paris 8
- République → Paris 3, Paris 10, Paris 11

Lignes de métro principales:
- Ligne 1: Château de Vincennes → Vincennes, Nation (12e), Bastille (4/11/12e), Châtelet (1/4e), Louvre (1er), Concorde (8e), Champs-Élysées (8e), La Défense (Puteaux)
- Ligne 2: Nation (11/12e) → Bastille (11e) → Père Lachaise (20e) → Ménilmontant → Belleville (11/19e) → Anvers (18e) → Pigalle (9/18e) → Place de Clichy (8/17e)
- Ligne 4: Montrouge → Alésia (14e) → Montparnasse (15e) → Saint-Germain (6e) → Cité (4e) → Châtelet → Gare du Nord (10e) → Barbès (18e)
- Ligne 6: Nation (12e) → Bercy (12e) → Daumesnil (12e) → Trocadéro (16e) → Montparnasse (15e)
- Ligne 9: Montreuil → Nation (11e) → Oberkampf (11e) → République (3/10/11e) → Opéra (9e) → Saint-Augustin (8e)
- Ligne 13: Châtillon/Montrouge → Malakoff → Montrouge → Alésia (14e) → Montparnasse → Invalides (7e) → Champs-Élysées (8e) → Saint-Lazare (8e) → Clichy → Saint-Denis/Asnières

Règles de décision:
- Arrondissement cité explicitement → status "clear"
- Commune citée explicitement (Vincennes, Neuilly-sur-Seine, etc.) → status "clear"
- Quartier parisien reconnu (Le Marais, Montmartre, Bastille, etc.) → status "clear"
- Plusieurs lieux bien identifiés combinés ("Neuilly ou Levallois", "Paris 11 et 12") → status "clear"
- Ligne de métro ou RER sans secteur précis → status "ambiguous", proposer 2-3 options géographiques
- Description lifestyle vague ("calme", "animé", "proche d'un parc") sans lieu précis → status "too_vague"
- Lieu inconnu ou hors zone → status "not_found"
- Pour "ambiguous" et "too_vague": toujours fournir clarificationOptions avec des query exploitables

Règles de désambiguïsation géographique (CRITIQUE — toujours appliquer):
- "Neuilly" seul ou associé à des communes/quartiers de l'ouest parisien (Levallois, Boulogne, Courbevoie, etc.) → toujours "Neuilly-sur-Seine" (jamais Neuilly-Plaisance qui est à l'est)
- "Neuilly" + contexte est parisien (Montreuil, Vincennes, Nation) → demander clarification
- "Marais" ou "Le Marais" → toujours le quartier du Marais (Paris 3e-4e), jamais une rue
- "Saint-Denis" → Saint-Denis (93), pas Saint-Denis-de-la-Réunion

Règles pour mapAction.preselectQueries (OBLIGATOIRE pour status "clear"):
- Toujours remplir preselectQueries avec les zones exactes correspondant à la demande
- Format: arrondissements "Paris 1" à "Paris 20", ou noms exacts de communes: "Neuilly-sur-Seine", "Vincennes", "Levallois-Perret"
- Pour un quartier: utiliser les arrondissements correspondants (ex: Le Marais → ["Paris 3", "Paris 4"])
- Pour plusieurs lieux: lister toutes les zones (ex: "Neuilly ou Levallois" → ["Neuilly-sur-Seine", "Levallois-Perret"])
- centerQuery: toujours le nom exact du lieu principal, reconnaissable (ex: "Le Marais", "Neuilly-sur-Seine", "Paris 11")`

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

RÈGLES CRITIQUES pour preselectZones (clarificationOptions) ET preselectQueries (mapAction):
- Format OBLIGATOIRE pour les arrondissements: "Paris 1", "Paris 4", "Paris 11", "Paris 18" (chiffre seul, sans "e"/"er")
- Format OBLIGATOIRE pour les communes: nom exact — "Vincennes", "Neuilly-sur-Seine", "Levallois-Perret", "Saint-Mandé", "Montreuil"
- Géographiquement correct: si label="Châtelet", preselectZones=["Paris 1","Paris 4"] — jamais ["Paris 14"]
- Si label="Montmartre", preselectZones=["Paris 18"] — Montmartre est dans le 18e
- Si label="Bastille", preselectZones=["Paris 4","Paris 11","Paris 12"]
- Si label="Le Marais", preselectZones=["Paris 3","Paris 4"]
- Pour status "clear" avec plusieurs lieux: mapAction.preselectQueries doit lister TOUTES les zones demandées
- centerQuery: nom exact du lieu, sans articles superflus. Ex: "Le Marais", "Montmartre", "Neuilly-sur-Seine", "Paris 11"`

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
