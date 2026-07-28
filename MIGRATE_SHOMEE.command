#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  MIGRATION SHOMEE — applique la migration Prisma (auth) à la base Neon.
#  Ajoute la table UserDevice + les champs de compte. Double-clique.
# ═══════════════════════════════════════════════════════════════════════
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node introuvable — ouvre depuis un Terminal où 'node -v' marche."
  read -r -p "Entrée pour fermer…"; exit 1
fi
echo "Shomee — migration de la base du $(date '+%d/%m/%Y %H:%M')"
cd apps/web || { echo "❌ dossier apps/web introuvable"; read -r -p "Entrée…"; exit 1; }
echo; echo "━━━━━━━━ Application des migrations (prisma migrate deploy) ━━━━━━━━"
if ! npx -y prisma migrate deploy; then
  echo
  echo "❌ La migration a échoué — copie-moi tout le message ci-dessus, je corrige."
  read -r -p "Entrée pour fermer…"; exit 1
fi
echo
echo "✅ Base à jour : table UserDevice + champs auth ajoutés à Neon."
read -r -p "Entrée pour fermer…"
