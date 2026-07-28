#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  SHOMEE — Envoie le dernier build iOS sur App Store Connect / TestFlight.
#  Double-clique. (À lancer APRÈS un build ✅.)
# ═══════════════════════════════════════════════════════════════════════
ROOT_DIR="$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
command -v eas  >/dev/null 2>&1 || { echo "❌ eas introuvable — lance d'abord INSTALL_EAS.command."; read -r -p "Entrée…"; exit 1; }

cd "$ROOT_DIR/apps/mobile" || { echo "❌ dossier apps/mobile introuvable"; read -r -p "Entrée…"; exit 1; }

echo "━━━━━━━━ Envoi vers App Store Connect / TestFlight ━━━━━━━━"
echo "• EAS peut redemander ta connexion Apple (+ code 2FA)."
echo "• Si l'app SHOMEE n'existe pas encore dans App Store Connect, il propose"
echo "  de LA CRÉER → accepte (il te demandera un « SKU » : mets par ex. shomee-app,"
echo "  c'est juste une référence interne, invisible du public)."
echo "• L'upload dure ~2-5 min, puis Apple « traite » le build ~10-15 min."
echo
eas submit --platform ios --profile production --latest

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Envoyé. Le build apparaît dans App Store Connect → onglet TestFlight"
echo "     après ~10-15 min de traitement Apple. Dis-le-moi, je te guide pour"
echo "     l'installer sur ton iPhone (test interne, sans revue)."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Entrée pour fermer…"
