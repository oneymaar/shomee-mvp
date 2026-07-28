#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  SHOMEE — Installe EAS CLI puis te connecte à Expo. Double-clique.
# ═══════════════════════════════════════════════════════════════════════
ROOT_DIR="$(dirname "$0")"
cd "$ROOT_DIR" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node introuvable — ouvre depuis un Terminal où 'node -v' marche."
  read -r -p "Entrée pour fermer…"; exit 1
fi

echo "Node $(node -v) — npm $(npm -v)"
echo
echo "━━━━━━━━ 1/2 — Installation d'EAS CLI ━━━━━━━━"
if npm install -g eas-cli; then
  echo "✅ EAS CLI installé : $(eas --version 2>/dev/null)"
else
  echo
  echo "❌ Échec de l'installation."
  echo "   Si l'erreur parle de permissions (EACCES), relance à la main dans un Terminal :"
  echo "        sudo npm install -g eas-cli"
  read -r -p "Entrée pour fermer…"; exit 1
fi

echo
echo "━━━━━━━━ 2/2 — Connexion à ton compte Expo ━━━━━━━━"
echo "(entre l'email + mot de passe de ton compte Expo — gratuit, créable sur expo.dev)"
echo "Si tu n'as pas encore de compte ou pas envie maintenant : tape Ctrl-C, on le fera après."
echo
cd "$ROOT_DIR/apps/mobile" 2>/dev/null
eas login

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Terminé. Connecté en tant que : $(eas whoami 2>/dev/null || echo '(non connecté)')"
echo "     Prochaine étape (dis-le-moi) : eas init puis le build iOS."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Entrée pour fermer…"
