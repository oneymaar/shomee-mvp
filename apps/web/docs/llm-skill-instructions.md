# SHOMEE — Skill LLM : import d'annonce depuis un assistant

Ce document décrit comment connecter un assistant IA externe (Claude, ChatGPT,
Gemini…) à SHOMEE pour qu'il puisse créer une annonce immobilière à partir
d'un brief libre, d'un PDF d'estimation, ou d'un échange de discussion.

## Endpoint

```
POST https://shomee-mvp.vercel.app/api/biens/import-llm
```

### En-têtes

| Header          | Valeur                                  |
|-----------------|-----------------------------------------|
| `Authorization` | `Bearer {API_KEY_AGENT}`                |
| `Content-Type`  | `application/json`                      |

### Body JSON

Seul `adresse` est obligatoire. Tout le reste est optionnel — n'envoyez que ce
que vous avez extrait avec confiance ; SHOMEE complétera le reste depuis l'app.

Chaque champ peut être doublé d'un champ `*_source` qui indique d'où vient la
donnée ("Mandat de vente", "DDT", "Rédigé par l'assistant", "Estimation PDF",
etc.). Ces marqueurs sont stockés en base et affichés à l'agent dans
l'éditeur — ils l'aident à arbitrer rapidement ce qui doit être vérifié.

```jsonc
{
  "adresse":                   "12 rue du Faubourg Saint-Honoré, 75008 Paris",
  "location_source":           "Mandat de vente",
  "prix":                      3500000,
  "prix_source":               "Mandat de vente",
  "surface":                   140,
  "surface_source":            "DDT",
  "nb_pieces":                 5,
  "nb_pieces_source":          "DDT",
  "nb_chambres":               3,
  "nb_chambres_source":        "DDT",
  "type_bien":                 "Appartement",
  "type_bien_source":          "Mandat de vente",
  "description":               "Haussmannien classique au 4ᵉ étage…",
  "description_source":        "Rédigé par l'assistant",
  "quartier":                  "Faubourg Saint-Honoré — Madeleine",
  "quartier_source":           "Déduit de l'adresse",
  "etage":                     4,
  "etage_source":              "Mandat de vente",
  "nb_etages_total":           6,
  "annee_construction":        1880,
  "annee_construction_source": "Estimation PDF",
  "caracteristiques":          ["Ascenseur", "Cave", "Gardien", "Parquet"],
  "specificites":              ["Pas de vis-à-vis", "Lumineux", "Hauteur sous plafond > 3m"],
  "composition":               [
    { "label": "Double salon", "surface": 48 },
    { "label": "Cuisine",      "surface": 14 }
  ],
  "composition_source":   "DDT",
  "mandat_type":          "EXCLUSIF",       // "SIMPLE" | "EXCLUSIF"
  "mandat_type_source":   "Mandat de vente",
  "avant_premiere":       true,
  "ref_interne":          "KRZ-8-FSH-0211",
  "ref_interne_source":   "Mandat de vente",
  "dpe":                  "B",              // "A" .. "G"
  "dpe_source":           "DDT",
  "ges":                  "C",
  "ges_source":           "DDT",
  "prix_fai":             3500000,
  "taxe_fonciere":        5400,
  "taxe_fonciere_source": "Avis d'imposition",
  "charges_copro":        720,
  "charges_copro_source": "Décompte de charges"
}
```

### Réponse 200

```json
{
  "success": true,
  "bien_id": "cmpqxxx0000abc",
  "completion_rate": 0.52,
  "fields_filled": 8,
  "fields_total": 15,
  "next_step_url": "/agent/biens/cmpqxxx0000abc/editer",
  "message": "Annonce créée à 52%. Ouvrez l'app SHOMEE pour ajouter la vidéo et finaliser."
}
```

### Erreurs

| Statut | Cas                                | Réponse                                                                   |
|--------|------------------------------------|---------------------------------------------------------------------------|
| 400    | `adresse` manquante / body invalide| `{ "error": "adresse est obligatoire" }`                                  |
| 401    | Clé API absente / invalide         | `{ "error": "Clé API invalide" }`                                         |
| 403    | Quota agence atteint               | `{ "error": "Quota atteint", "current": 200, "max": 200, "message": …  }` |
| 500    | Erreur serveur                     | `{ "error": "Erreur serveur" }`                                           |

## Exemple `curl`

```bash
curl -X POST https://shomee-mvp.vercel.app/api/biens/import-llm \
  -H "Authorization: Bearer shomee_test_kr3tz_0001" \
  -H "Content-Type: application/json" \
  -d '{
    "adresse": "12 rue du Faubourg Saint-Honoré, 75008 Paris",
    "prix": 3500000,
    "surface": 140,
    "nb_pieces": 5,
    "nb_chambres": 3,
    "type_bien": "Appartement",
    "description": "Haussmannien classique au 4ᵉ étage, balcon filant, moulures.",
    "caracteristiques": ["Ascenseur", "Cave", "Gardien", "Parquet"],
    "specificites": ["Pas de vis-à-vis", "Lumineux"],
    "dpe": "B",
    "ges": "C"
  }'
```

## Endpoint compagnon — Lister ses clés

```
GET /api/agent/me/api-keys
Authorization: Bearer {API_KEY_AGENT}
```

Réponse :

```json
{
  "keys": [
    {
      "id": "...",
      "label": "Token de test",
      "key": "shomee_test_kr3tz_0001",
      "createdAt": "2026-05-28T09:32:29.000Z",
      "lastUsed": "2026-05-28T10:15:01.000Z"
    }
  ]
}
```

---

## Prompt système — à coller dans Claude / ChatGPT / Gemini

Voici un prompt clé en main pour transformer l'assistant en outil de
préparation d'annonce SHOMEE. L'utilisateur final décrit son bien librement,
l'assistant remplit le JSON et appelle l'endpoint.

```
Tu es un assistant immobilier qui aide un agent à créer une annonce SHOMEE
à partir d'un brief libre (texte, PDF d'estimation, transcription de visite).

RÔLE
Ta seule tâche est de produire un appel à l'endpoint d'import SHOMEE :
POST https://shomee-mvp.vercel.app/api/biens/import-llm

AUTHENTIFICATION
Tu utilises la clé API de l'agent connecté, fournie via la variable
{API_KEY_AGENT}. Mets-la dans le header Authorization: Bearer {API_KEY_AGENT}.

EXTRACTION
À partir du brief de l'agent, extrais les champs suivants quand ils sont
mentionnés sans ambiguïté (sinon, laisse-les vides — il complètera dans
l'app) :

- adresse (OBLIGATOIRE — adresse postale complète)
- prix (montant en euros, entier)
- surface (m²)
- nb_pieces, nb_chambres
- type_bien ("Appartement", "Maison", "Loft", "Atelier")
- description (paragraphe rédigé, ton agence haut de gamme)
- quartier (nom du micro-quartier, ex: "Île Saint-Louis")
- etage, nb_etages_total
- annee_construction
- caracteristiques (liste de tags simples, ex: ["Ascenseur","Cave","Parquet"])
- specificites (liste d'observations plus fines, ex: ["Pas de vis-à-vis",
  "Hauteur sous plafond > 3m","Cuisine ouverte"])
- composition (liste { label, surface en m² })
- mandat_type ("SIMPLE" ou "EXCLUSIF")
- avant_premiere (booléen)
- ref_interne (référence agence)
- dpe, ges ("A" à "G")
- prix_fai, taxe_fonciere, charges_copro (entiers en €)

RÈGLES
1. Ne jamais inventer une adresse. Si l'utilisateur ne fournit pas
   d'adresse précise, demande-la avant tout appel.
2. Ne jamais inventer un DPE ou un GES. Laisse vide si non fourni.
3. Pour les specificites, privilégie des observations qualitatives
   discrètes ("Lumineux", "Calme", "Vue dégagée") — pas de superlatifs
   marketing exagérés.
4. Pour la description, garde un ton sobre, factuel, environ 60–120 mots.
5. Une fois l'appel effectué, transmets à l'agent :
   - le bien_id
   - le pourcentage de complétion (completion_rate × 100)
   - le lien next_step_url à ouvrir dans l'app SHOMEE
   - les éléments manquants notables pour qu'il sache quoi compléter

FORMAT DE SORTIE
Réponds en français, brièvement, avec à la fin un bloc indiquant le bien_id
et le lien d'édition.
```

## Notes d'intégration

- La clé API est portée par l'agent (`AgentApiKey`), pas par l'agence. Un
  agent peut avoir plusieurs clés (Claude, ChatGPT, etc.) avec des labels
  distincts pour les différencier.
- Le bien créé est en statut `DRAFT` — il ne sera pas publié tant que
  l'agent n'a pas confirmé manuellement depuis l'app.
- Les `specificites` sont stockées comme des `PropertyTag` avec
  `source: AI_DOC`, `validated: false`, `confidence: 0.8` — l'agent peut
  les valider, modifier ou supprimer dans la section "Spécificités" de
  l'éditeur.
- Le `completionRate` est calculé sur 15 champs clés et utilisé partout
  dans l'app (barre de progression de l'éditeur, badge de complétion du
  dashboard).
