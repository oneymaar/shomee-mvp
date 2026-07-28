#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  BACKFILL SHOMEE — remplit les vrais attributs (tri-état) + zone IRIS
#  des 1500 biens. Le reste (migration, déploiement) est déjà fait.
#  Double-clique. Peut prendre 1-2 min (chargement des zones IRIS).
# ═══════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node introuvable — ouvre depuis un Terminal où 'node -v' marche."
  read -r -p "Entrée pour fermer…"; exit 1
fi

LOG="backfill-shomee.log"; : > "$LOG"
exec > >(tee "$LOG") 2>&1
echo "Shomee — backfill du $(date '+%d/%m/%Y %H:%M')"
echo

( cd apps/web && npx -y tsx scripts/backfill-attributes.ts --write )
CODE=$?

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$CODE" = 0 ]; then
  echo "  ✅ Backfill terminé. Regarde le rapport ci-dessus"
  echo "     (biens modifiés / irisId calculés)."
else
  echo "  ⚠️  Le backfill a rencontré un souci — envoie-moi backfill-shomee.log."
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Entrée pour fermer…"
