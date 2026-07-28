#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  SHOMEE — Build iOS de production (pour TestFlight). Double-clique.
#  EAS te demandera ta connexion Apple ; il gère les certificats tout seul.
# ═══════════════════════════════════════════════════════════════════════
ROOT_DIR="$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
command -v eas  >/dev/null 2>&1 || { echo "❌ eas introuvable — lance d'abord INSTALL_EAS.command."; read -r -p "Entrée…"; exit 1; }

cd "$ROOT_DIR/apps/mobile" || { echo "❌ dossier apps/mobile introuvable"; read -r -p "Entrée…"; exit 1; }

echo "Connecté à Expo : $(eas whoami 2>/dev/null || echo '??')"
echo
echo "━━━━━━━━ Build iOS — profil production ━━━━━━━━"
echo "• EAS va te demander de te connecter à ton compte APPLE (email, mot de passe, code 2FA)."
echo "  → Réponds « Yes » quand il propose de gérer/générer les certificats : il fait tout seul."
echo "• Le build tourne ensuite ~15-30 min dans le cloud (file gratuite = un peu lente)."
echo "  Tu peux suivre l'avancement ici : https://expo.dev/accounts/neymaarjr/projects/shomee/builds"
echo "  (Tu peux même fermer cette fenêtre une fois le build lancé : il continue côté cloud.)"
echo
eas build --platform ios --profile production

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Quand le build est ✅ (statut « finished »), dis-le-moi :"
echo "  on enchaîne sur l'envoi vers TestFlight (eas submit)."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Entrée pour fermer…"
