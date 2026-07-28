#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  SHOMEE — Lie le projet Expo + transfère les variables d'API vers EAS.
#  Double-clique. (À lancer APRÈS INSTALL_EAS.command.)
# ═══════════════════════════════════════════════════════════════════════
ROOT_DIR="$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
command -v eas  >/dev/null 2>&1 || { echo "❌ eas introuvable — lance d'abord INSTALL_EAS.command."; read -r -p "Entrée…"; exit 1; }

cd "$ROOT_DIR/apps/mobile" || { echo "❌ dossier apps/mobile introuvable"; read -r -p "Entrée…"; exit 1; }
ENVF="$ROOT_DIR/apps/mobile/.env"

echo "Connecté à Expo : $(eas whoami 2>/dev/null || echo '??')"
echo
echo "━━━━━━━━ 1/2 — Lier le projet Expo (eas init) ━━━━━━━━"
echo "(réponds « Y » si on te propose de créer le projet @neymaarjr/shomee)"
eas init

echo
echo "━━━━━━━━ 2/2 — Transfert des variables vers EAS (environnement production) ━━━━━━━━"
getval() {
  local v
  v=$(grep -E "^$1=" "$ENVF" 2>/dev/null | head -1 | cut -d= -f2-)
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}
URL=$(getval EXPO_PUBLIC_API_BASE_URL)
APP=$(getval EXPO_PUBLIC_SHOMEE_APP_TOKEN)
BYP=$(getval EXPO_PUBLIC_VERCEL_BYPASS_TOKEN)

if [ -z "$APP" ] || [ -z "$BYP" ]; then
  echo "⚠️  Tokens introuvables dans apps/mobile/.env — on continue, mais l'app risque d'être vide."
fi

[ -n "$URL" ] && eas env:create --name EXPO_PUBLIC_API_BASE_URL     --value "$URL" --environment production --visibility plaintext  --non-interactive 2>&1 | tail -2 || true
[ -n "$APP" ] && eas env:create --name EXPO_PUBLIC_SHOMEE_APP_TOKEN --value "$APP" --environment production --visibility sensitive --non-interactive 2>&1 | tail -2 || true
[ -n "$BYP" ] && eas env:create --name EXPO_PUBLIC_VERCEL_BYPASS_TOKEN --value "$BYP" --environment production --visibility sensitive --non-interactive 2>&1 | tail -2 || true

echo
echo "Variables EAS actuelles (valeurs sensibles masquées par EAS) :"
eas env:list --environment production 2>/dev/null | grep -E "EXPO_PUBLIC" || echo "(liste vide ou déjà à jour)"
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Projet lié + variables transférées."
echo "     Prochaine étape : le build iOS (eas build) — je te prépare ça."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Entrée pour fermer…"
