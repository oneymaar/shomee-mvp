# shomee-mcp

Serveur **MCP (Model Context Protocol)** pour SHOMEE. Branche n'importe quel
client MCP (Claude Desktop, Claude Code, etc.) sur l'API SHOMEE et permet à
l'IA de créer et gérer des annonces immobilières à partir d'une conversation
naturelle avec l'agent.

## Outils exposés

| Outil                  | Description                                                |
|------------------------|------------------------------------------------------------|
| `shomee_creer_annonce` | Crée une annonce en brouillon (24 champs, adresse seule obligatoire) |
| `shomee_lister_biens`  | Liste les biens de l'agent connecté (tous statuts)         |
| `shomee_get_bien`      | Détails complets d'un bien par son `bien_id`               |

Le serveur expose aussi un bloc `instructions` qui guide l'IA sur la manière
de mener l'échange avec l'agent (analyse des pièces jointes, questions par
thème, récapitulatif + confirmation avant création, lien d'édition après).

## Pré-requis

- **Node.js ≥ 18**
- Une **clé API agent** SHOMEE — récupérable via `GET /api/agent/me/api-keys`
  ou directement en base. Pour le test, la clé seed est :
  `shomee_test_kr3tz_0001`.

## Build local

```bash
cd shomee-mcp
npm install
npm run build
```

L'exécutable atterrit dans `dist/index.js` avec un shebang `#!/usr/bin/env node`.

Tester en standalone :

```bash
SHOMEE_API_KEY="shomee_test_kr3tz_0001" node dist/index.js
# le serveur écoute sur stdin/stdout — Ctrl+C pour quitter
```

## Variables d'environnement

| Variable         | Défaut                              | Rôle                                   |
|------------------|-------------------------------------|----------------------------------------|
| `SHOMEE_API_KEY` | _(requis)_                          | Clé Bearer de l'agent                  |
| `SHOMEE_API_URL` | `https://shomee-mvp.vercel.app`     | Base URL de l'API SHOMEE (override en dev) |

## Configuration Claude Desktop

Ouvrez le fichier de configuration :

- **macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** : `%APPDATA%\Claude\claude_desktop_config.json`

Ajoutez l'entrée `shomee` dans `mcpServers` :

```json
{
  "mcpServers": {
    "shomee": {
      "command": "node",
      "args": [
        "/Users/oliviermenart/shomee-mvp/shomee-mcp/dist/index.js"
      ],
      "env": {
        "SHOMEE_API_KEY": "shomee_test_kr3tz_0001"
      }
    }
  }
}
```

Adaptez le chemin absolu de `dist/index.js` à votre machine. Pour pointer vers
un déploiement local Next.js plutôt que la prod, ajoutez
`"SHOMEE_API_URL": "http://localhost:3000"` dans `env`.

Redémarrez Claude Desktop. Les 3 outils apparaissent dans le menu 🔌 du
composer ; vous pouvez maintenant écrire :

> _"J'ai un T3 de 65 m² rue de Bretagne dans le 3ᵉ, à 850 000 €, parquet,
> ascenseur, refait à neuf — peux-tu créer l'annonce ?"_

Claude vous posera quelques questions complémentaires puis appellera
`shomee_creer_annonce` après confirmation.

## Configuration Claude.ai (web — connecteurs)

Les **connecteurs MCP** côté web exigent un serveur exposé en HTTP (pas
stdio). Le serveur fourni ici est un serveur **stdio** local, donc pas
directement compatible avec Claude.ai web pour le moment.

Pour exposer SHOMEE sur Claude.ai, deux pistes :

1. **Empaqueter dans Claude Desktop / Claude Code** — déjà compatibles (voir
   plus haut), c'est la voie immédiate.
2. **Déployer un wrapper HTTP / SSE** — créer un second binaire qui réutilise
   les mêmes outils mais via le transport `SSEServerTransport` du SDK MCP, et
   l'héberger derrière une URL publique (ex. Vercel Function). Ce wrapper
   n'est pas inclus dans ce dépôt.

## Configuration Claude Code

Claude Code lit le même format de config que Claude Desktop. La commande la
plus simple :

```bash
claude mcp add shomee node /Users/oliviermenart/shomee-mvp/shomee-mcp/dist/index.js --env SHOMEE_API_KEY=shomee_test_kr3tz_0001
```

(adaptez le chemin)

## Architecture

```
Claude Desktop / Claude Code  ──stdio──▶  shomee-mcp (Node)  ──HTTPS──▶  shomee-mvp.vercel.app
                                                                              │
                                                                              ├─ POST /api/biens/import-llm
                                                                              ├─ GET  /api/agent/me/properties
                                                                              └─ GET  /api/biens/{id}
```

Le serveur MCP est **stateless** : il agit comme un pont entre l'IA et l'API
SHOMEE. Toute la logique métier (auth Bearer, validation Zod, quota,
completionRate, création Prisma) reste côté Next.js.

## Dépannage

- **Le serveur démarre mais Claude ne voit pas les outils** — vérifiez les
  logs Claude Desktop (`~/Library/Logs/Claude/mcp.log`). Le plus souvent :
  chemin absolu de `dist/index.js` incorrect, ou Node introuvable dans le
  `PATH` du processus Claude.
- **`Clé API invalide`** — la valeur de `SHOMEE_API_KEY` n'existe pas dans
  Neon. Vérifiez avec `curl -H "Authorization: Bearer $KEY"
  https://shomee-mvp.vercel.app/api/agent/me/api-keys`.
- **`Quota atteint`** — l'agence a atteint `agency.maxProperties`. Il faut
  archiver des biens ou passer en Pro.

## Voir aussi

- [`docs/llm-skill-instructions.md`](../docs/llm-skill-instructions.md) —
  référence brute de l'endpoint d'import et prompt système pour LLM sans MCP.
