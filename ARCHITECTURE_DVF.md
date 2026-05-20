# Architecture — Données prix marché DVF

## Contexte
Shomee MVP est une application Next.js stateless hébergée sur Vercel.
Pas de base de données. Toutes les données sont des fichiers JSON statiques
dans `src/data/`, des APIs externes à la demande, et Zustand + localStorage.

## Problème à résoudre
Après la sélection des zones (IRIS), avant la saisie du budget, afficher
une fourchette de prix au m² pour ancrer l'utilisateur dans la réalité du marché.
Source : données DVF (transactions notariales officielles).

## Décisions d'architecture

- **Granularité : quartier Shomee** — pas IRIS INSEE. La clé du fichier prix
  = `id` du quartier (`"chatelet"`, `"beaubourg"`…). Évite le problème
  d'unicité des noms labels IRIS.

- **Stockage : fichier JSON statique** — `src/data/iris_market.json` embarqué
  dans le build. Zéro appel API à l'usage, zéro coût récurrent, cohérent
  avec l'architecture stateless existante.

- **Source des prix : Intent Analytics API** — endpoint
  `GET /v1/market/snapshot` par arrondissement (`code_commune` 75101–75120).
  Prix médian + P25 + P75 + volume. 0,005€/requête. Plan Starter 19€/mois.

- **Rayon géographique : aucun** — l'approche rayon fixe est rejetée car
  inadaptée à la densité variable des IRIS. On travaille à la maille
  arrondissement pour le MVP.

- **Génération : batch ponctuel** — script Node lancé une fois, résultat
  commité dans le repo. Rafraîchissement manuel 1–2x/an.

## Fichiers à créer

### `scripts/generate-iris-market.ts`
Script à lancer une fois. Pour chaque arrondissement parisien :
→ appel Intent Analytics `GET /v1/market/snapshot?code_commune=75101&type=apartment`
→ associe le prix à chaque quartier Shomee de cet arrondissement
→ écrit `src/data/iris_market.json`

### `src/data/iris_market.json`
```json
{
  "chatelet":  { "median": 11200, "p25": 9800, "p75": 13100, "n": 142, "arr": "arr-1",  "updated": "2026-01" },
  "beaubourg": { "median": 10900, "p25": 9600, "p75": 12400, "n": 87,  "arr": "arr-4",  "updated": "2026-01" },
  "aligre":    { "median": 9400,  "p25": 8300, "p75": 10600, "n": 203, "arr": "arr-12", "updated": "2026-01" }
}
```

### `hooks/usePrixSecteur.ts`
Reçoit un tableau de `quartierIds[]` → agrège les médianes pondérées par
volume → retourne fourchette + label prêt à afficher.

### v2 — maille IRIS fine
Mapping `nom_label + arrondissement → code INSEE 9 chiffres` via référentiel
IGN. Permet d'appeler `GET /v1/market/snapshot?code_iris=...` directement.

## Prérequis
- Vérifier que chaque quartier dans `shomee_quartiers.json` est bien rattaché
  à un arrondissement (champ `arr` ou équivalent)
- Créer un compte Intent Analytics Starter (19€/mois, résiliable J+1)
  pour obtenir une clé API

## Étapes d'implémentation
1. Créer compte Intent Analytics → récupérer clé API
2. Écrire `scripts/generate-iris-market.ts`
3. Lancer le script → commiter `src/data/iris_market.json`
4. Écrire `hooks/usePrixSecteur.ts`
5. Intégrer dans l'étape budget de l'onboarding
