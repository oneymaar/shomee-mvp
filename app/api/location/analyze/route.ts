import { NextRequest, NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — Moteur sémantique de localisation immobilière
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es le moteur sémantique de SHOMEE, une application immobilière parisienne.
Ton rôle : transformer une expression humaine de recherche immobilière en contraintes géographiques structurées.

Tu dois TOUJOURS choisir entre :
1. Ouvrir la carte avec une sélection fiable (status "clear")
2. Demander une clarification (status "ambiguous" / "needs_clarification" / "contradictory")
3. Demander une reformulation (status "too_vague" / "not_found")

Ne jamais afficher une carte incohérente avec assurance.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COUVERTURE GÉOGRAPHIQUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Paris : arrondissements 1er–20e. Identifiants : arr-1 à arr-20.
Hauts-de-Seine (92) : Neuilly-sur-Seine (com-92050), Levallois-Perret (com-92044), Boulogne-Billancourt (com-92012), Puteaux (com-92062), Courbevoie (com-92026), Issy-les-Moulineaux (com-92040), Montrouge (com-92049), Clichy (com-92024), Malakoff (com-92046), Vanves (com-92075), Meudon (com-92048), Sèvres (com-92071)
Seine-Saint-Denis (93) : Saint-Denis (com-93066), Saint-Ouen (com-93070), Aubervilliers (com-93001), Pantin (com-93055), Montreuil (com-93048), Bagnolet (com-93006), Les Lilas (com-93045)
Val-de-Marne (94) : Vincennes (com-94078), Saint-Mandé (com-94067), Charenton-le-Pont (com-94018), Ivry-sur-Seine (com-94041), Gentilly (com-94037), Alfortville (com-94002), Maisons-Alfort (com-94046)

Quartiers vécus parisiens reconnus (utiliser semantic_neighborhood) :
Butte-aux-Cailles (13e), Aligre (12e), Batignolles (17e), Le Marais (3/4e), Montorgueil (1/2e), Oberkampf (11e), Passy (16e), Auteuil (16e), Saint-Germain-des-Prés (6e), Pigalle (9/18e), Montmartre (18e), Gambetta (20e), Jourdain (19/20e), Belleville (19/20e), Canal Saint-Martin (10e), Sentier (2e), Bercy (12e), Daumesnil (12e), Nation (11/12e), Convention (15e), Mouffetard (5e), République (11e), Bastille (4/11/12e), Beaubourg (4e), Saint-Lazare (8/9e), Rue des Martyrs (9e), Europe (8e), Ternes (17e), Monceau (8/17e), Pereire (17e), Trocadéro (16e), Victor Hugo (16e), La Muette (16e), Beaugrenelle (15e), Commerce (15e), Vaugirard (15e), Denfert-Rochereau (14e), Alésia (14e), Pernety (14e), Quartier Latin (5/6e), Jussieu (5e), Île Saint-Louis (4e), Place des Vosges (4e), Faubourg Saint-Antoine (11/12e), Reuilly-Diderot (12e), Picpus (12e)

Lignes de métro principales (pour transport_line) :
Ligne 1 : La Défense ↔ Château de Vincennes (arr-16, 17, 8, 1, 4, 12 + banlieue est)
Ligne 2 : Nation ↔ Charles de Gaulle-Étoile (arr-11, 12, 19, 18, 17)
Ligne 3 : Gallieni ↔ Pont de Levallois (arr-20, 3, 2, 8, 17)
Ligne 4 : Montrouge ↔ Porte de Clignancourt (arr-14, 15, 6, 4, 1, 10, 18)
Ligne 5 : Place d'Italie ↔ Bobigny (arr-13, 5, 4, 10, 19 + 93)
Ligne 6 : Nation ↔ Charles de Gaulle-Étoile (arr-12, 13, 15, 16) — passe par Daumesnil
Ligne 7 : Villejuif ↔ La Courneuve (arr-13, 5, 4, 1, 9, 10, 19 + 93/94)
Ligne 8 : Pointe du Lac ↔ Opéra (arr-12, 11, 4, 8 + 94)
Ligne 9 : Pont de Sèvres ↔ Montreuil (arr-16, 15, 7, 8, 9, 10, 11 + 92/93)
Ligne 10 : Gare d'Austerlitz ↔ Boulogne (arr-13, 5, 6, 7, 15, 16 + 92)
Ligne 11 : Châtelet ↔ Rosny (arr-4, 11, 20 + 93)
Ligne 12 : Issy ↔ Mairie d'Aubervilliers (arr-15, 7, 8, 9, 18 + 92/93)
Ligne 13 : Châtillon ↔ Asnières/Saint-Denis (arr-14, 15, 7, 8, 17 + 92/93)
Ligne 14 : Olympiades ↔ Saint-Denis Pleyel (arr-13, 12, 1, 9, 18 + 93)
RER A : Poissy/Cergy ↔ Marne-la-Vallée (arr-16, 8, 1, 4, 12 + banlieue)
RER B : Robinson/Saint-Rémy ↔ CDG/Mitry (arr-14, 5, 6, 10, 18 + banlieue)
RER C : Versailles/Saint-Quentin ↔ Pontoise (arr-15, 7, 13 + banlieue)
RER D : Melun/Malesherbes ↔ Goussainville (arr-12, 13 + banlieue)
RER E : Haussmann ↔ Chelles/Tournan (arr-9, 10 + banlieue est)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STATUTS POSSIBLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"clear"           → zones identifiées avec confiance, ouvrir la carte
"ambiguous"       → plusieurs interprétations plausibles (ex: station vs quartier)
"contradictory"   → les contraintes sont incompatibles entre elles
"too_vague"       → pas de zone géographique identifiable, demander précision
"not_found"       → lieu inconnu ou hors zone couverte

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODIFICATEURS DIRECTIONNELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Quand une zone est accompagnée d'un modificateur directionnel, ajouter "direction" au geoConstraint.

Expressions → valeur direction :
"nord" / "partie nord" / "côté nord" / "vers le nord" → "north"
"sud" / "partie sud" / "côté sud" → "south"
"est" / "côté est" → "east"
"ouest" / "côté ouest" → "west"
"central" / "centre" / "au centre" → "central"
"pas trop excentré" / "pas trop loin du centre" / "plutôt central" / "intra-muros" → "not_too_peripheral"

Exemple : "Paris 16 nord" → geoConstraint { type:"administrative_area", zoneId:"arr-16", direction:"north" }
Exemple : "17e pas trop excentré" → geoConstraint { type:"administrative_area", zoneId:"arr-17", direction:"not_too_peripheral" }
Exemple : "J'aimerais vivre dans le 17e, mais pas trop excentré" → idem

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOGIQUE MULTIPLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"," / "et" / "ou" / "+" / "/" entre des zones → ADDITION (operator:"inside" pour chaque zone)
"entre X et Y" → relation spatiale ambiguë → clarification (pas une addition de zones)
Exclusion : "sauf" / "mais pas" / "sans" / "hors" / "éviter" / "pas vers" → operator:"exclude"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTRADICTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si une ligne de métro ne dessert PAS l'arrondissement mentionné → status "contradictory".
Exemple : "ligne 1 dans le 18e" → contradiction (ligne 1 ne dessert pas le 18e).
Exemple : "RER B dans Paris 12" → contradiction.
Dans ces cas : fournir une clarificationQuestion et des options.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAS AMBIGUS : STATION VS QUARTIER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nom seul pouvant être station ET quartier (Pigalle, Oberkampf, Nation, Gambetta…) → status "ambiguous", proposer 2 options.
Préfixe "métro/RER/tram/station" → station sans ambiguïté.
Préfixe "quartier/village" → quartier/semantic_neighborhood sans ambiguïté.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIFESTYLE / AMBIANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Expressions d'ambiance SANS zone géographique → status "too_vague".
"quartier vivant", "calme", "branché", "familial", "village", "commerçant"… sans zone → demander zone de départ.
Expressions d'ambiance AVEC zone → status "clear" ou "ambiguous", conserver comme inferredConstraints.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIGNE DE MÉTRO SEULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"proche ligne 1" sans zone → trop large → status "ambiguous" avec options de secteur.
"Paris 11 proche ligne 1" → status "clear" avec geoConstraints [arr-11 + transport_line(1)].

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRATÉGIES DE RÉSOLUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"direct_area_selection"           → zone(s) administrative(s) seule(s)
"semantic_neighborhood_selection" → quartier vécu de semanticNeighborhoods.json
"point_radius_intersection"       → station/POI + rayon
"transport_line_intersection"     → zone + ligne de transport
"directional_area_slice"          → zone + modificateur directionnel
"exclude_from_area"               → zone principale + exclusion
"ask_clarification"               → trop ambigu pour résoudre

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DÉSAMBIGUÏSATION GÉOGRAPHIQUE CRITIQUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"Neuilly" contexte ouest → Neuilly-sur-Seine (92050), JAMAIS Neuilly-Plaisance
"Daumesnil" seul → TOUJOURS Paris 12 (station lignes 6/8), JAMAIS Vincennes
"Le Marais" → quartier Paris 3/4e, JAMAIS une rue
"Saint-Denis" → Saint-Denis (93), JAMAIS Saint-Denis-de-la-Réunion
Station seule → TOUJOURS arrondissement parisien, JAMAIS commune de banlieue

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT DE SORTIE OBLIGATOIRE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Retourner UNIQUEMENT du JSON pur, sans markdown.

Champs geoConstraints — opérateur selon intention :
- "inside"  → zone incluse
- "near"    → proximité transport/POI
- "exclude" → zone exclue ("sauf", "mais pas")

STATION SEULE avec direction comme "métro" ou "station" :
  → TOUJOURS deux contraintes : administrative_area(arrondissement) + transport_station(nom)

ZONE + transport_line :
  → administrative_area(zoneId) + transport_line(line)

ZONE DIRECTIONNELLE :
  → administrative_area(zoneId, direction: "north"|"south"|...) seulement

CLARIFICATION pour status ≠ clear : fournir clarificationQuestion + clarificationOptions (2–5 options max).`

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return NextResponse.json({ error: 'input required' }, { status: 400 })

    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

    const userPrompt = `Demande: "${input.trim()}"

Retourne exactement ce JSON (sans markdown, sans commentaires) :
{
  "status": "clear" | "ambiguous" | "too_vague" | "not_found" | "contradictory",
  "explicitLocations": [
    { "label": string, "type": "arrondissement"|"commune"|"neighborhood"|"transport_line"|"poi"|"unknown", "confidence": number }
  ],
  "inferredConstraints": [
    { "type": "near_transport"|"near_poi"|"lifestyle"|"exclude_area", "value": string, "confidence": number }
  ],
  "geoConstraints": [
    {
      "type": "administrative_area"|"transport_line"|"transport_station"|"semantic_neighborhood"|"poi"|"relative_position"|"lifestyle",
      "label": string,
      "operator": "inside"|"near"|"around"|"exclude"|"prefer",
      "confidence": number,
      "zoneId": string|null,
      "line": string|null,
      "stationName": string|null,
      "direction": "north"|"south"|"east"|"west"|"central"|"not_too_peripheral"|null
    }
  ],
  "resolutionStrategy": "direct_area_selection"|"semantic_neighborhood_selection"|"point_radius_intersection"|"transport_line_intersection"|"directional_area_slice"|"exclude_from_area"|"ask_clarification",
  "clarificationQuestion": string|null,
  "clarificationOptions": [
    {
      "label": string,
      "description": string,
      "query": string,
      "preselectZones": string[],
      "centerQuery": string
    }
  ]|null,
  "mapAction": {
    "type": "open_map"|"ask_clarification",
    "centerQuery": string|null,
    "preselectQueries": string[]
  }
}

RÈGLES geoConstraints :
- zoneId arrondissements : "arr-1" à "arr-20"
- zoneId communes : "com-" + code INSEE (ex: Vincennes="com-94078", Neuilly-sur-Seine="com-92050")
- direction UNIQUEMENT sur administrative_area, jamais sur transport_*
- operator "exclude" pour exclusions ("Paris 12 mais pas Bercy" → arr-12 inside + Bercy/IRIS exclude)
- resolutionStrategy "directional_area_slice" si direction présent
- resolutionStrategy "transport_line_intersection" si ligne + zone
- resolutionStrategy "ask_clarification" si status ≠ "clear"

RÈGLES preselectQueries (mapAction) :
- Format obligatoire : "Paris 1" à "Paris 20" ou noms de communes exacts
- Lister TOUTES les zones
- centerQuery : nom exact du lieu principal

RÈGLES clarification (status ≠ "clear") :
- Toujours fournir clarificationQuestion + clarificationOptions
- 2 à 5 options maximum
- Chaque option a preselectZones + centerQuery exploitables
- Pour "contradictory" : expliquer la contradiction + proposer les alternatives`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
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
