#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  MISE À JOUR SHOMEE — matching tri-état + déploiement API + backfill
#  Double-clique sur ce fichier : tout s'enchaîne automatiquement.
#  Journal complet écrit dans maj-shomee.log (lisible par Claude).
# ═══════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")" || exit 1

# PATH minimal des .command : on ajoute les emplacements node usuels.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node introuvable — ouvre ce script depuis un Terminal où 'node -v' marche."
  read -r -p "Entrée pour fermer…"; exit 1
fi

LOG="maj-shomee.log"; : > "$LOG"
exec > >(tee "$LOG") 2>&1
echo "Shomee — mise à jour du $(date '+%d/%m/%Y %H:%M') — node $(node -v)"
SOFT_FAIL=0

# étape CRITIQUE : on stoppe net si elle échoue
crit() { local t="$1"; shift; echo; echo "━━━━━━━━ $t ━━━━━━━━"
  if ! "$@"; then echo; echo "❌ ÉCHEC à cette étape — arrêt."; echo "   Envoie-moi le fichier maj-shomee.log, je corrige."; read -r -p "Entrée pour fermer…"; exit 1; fi; }
# étape NON bloquante : on signale mais on continue
soft() { local t="$1"; shift; echo; echo "━━━━━━━━ $t ━━━━━━━━"
  if ! "$@"; then echo "⚠️  Cette étape a averti (non bloquant) — détails dans le log."; SOFT_FAIL=1; fi; }

crit "ÉTAPE 1/5 — Migration base de données"      bash -c 'cd apps/web && npx -y prisma db push'
crit "ÉTAPE 2/5 — Régénération client Prisma"     bash -c 'cd apps/web && npx -y prisma generate'
soft "ÉTAPE 3/5 — Harnais matching (43/0 attendu)" bash -c 'cd packages/core && npx -y tsx scripts/matching-harness.ts'
crit "ÉTAPE 4/5 — Déploiement API (push → Vercel)" git push origin feat/proto-quartiers:feat/monorepo
soft "ÉTAPE 5/5 — Backfill tri-état + IRIS (peut prendre 1-2 min)" bash -c 'cd apps/web && npx -y tsx scripts/backfill-attributes.ts --write'

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$SOFT_FAIL" = 0 ]; then
  echo "  ✅ TERMINÉ — tout est passé."
else
  echo "  ✅ Étapes critiques OK (base migrée + API déployée)."
  echo "     Une étape non bloquante a averti — envoie-moi maj-shomee.log."
fi
echo
echo "  Pour tester, quand tu veux :"
echo "     npm run dev:mobile      puis recharge l'app sur l'iPhone"
echo "  (Vercel déploie l'API pendant ~2 min — laisse-lui ce délai.)"
echo "  Tu peux fermer cette fenêtre."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Entrée pour fermer…"
