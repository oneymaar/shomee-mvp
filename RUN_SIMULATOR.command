#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  SHOMEE — Lance l'app dans le Simulateur iOS du Mac (build LOCAL Xcode,
#  bien plus rapide qu'EAS). Double-clique. Laisse la fenêtre ouverte :
#  Metro tourne, et toute modif de code se recharge en direct (Fast Refresh).
# ═══════════════════════════════════════════════════════════════════════
cd "$(dirname "$0")/apps/mobile" || { echo "❌ apps/mobile introuvable"; read -r -p "Entrée…"; exit 1; }
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node introuvable — ouvre depuis un Terminal où 'node -v' marche."
  read -r -p "Entrée pour fermer…"; exit 1
fi

echo "Lancement dans le Simulateur iOS…"
echo "(1re fois : compilation Xcode ~2-5 min ; ensuite l'app se recharge en direct.)"
echo
npx expo run:ios

echo
echo "Si tu vois une erreur ci-dessus, colle-la-moi."
read -r -p "Entrée pour fermer…"
