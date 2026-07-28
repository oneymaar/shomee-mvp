#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  DÉPLOIEMENT SHOMEE — build de vérif EN LOCAL puis push vers Vercel.
#  Le build local attrape toute erreur AVANT de pousser (plus de
#  déploiement Vercel raté). Double-clique.
# ═══════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node introuvable — ouvre depuis un Terminal où 'node -v' marche."
  read -r -p "Entrée pour fermer…"; exit 1
fi

LOG="deploy-shomee.log"; : > "$LOG"
exec > >(tee "$LOG") 2>&1
echo "Shomee — déploiement du $(date '+%d/%m/%Y %H:%M')"

echo; echo "━━━━━━━━ 1/3 — Client Prisma à jour ━━━━━━━━"
( cd apps/web && npx -y prisma generate ) || { echo "❌ prisma generate a échoué — envoie-moi deploy-shomee.log."; read -r -p "Entrée…"; exit 1; }

echo; echo "━━━━━━━━ 2/3 — Build de vérification (comme Vercel) ━━━━━━━━"
echo "(peut prendre ~1 min ; c'est ce qui garantit que le déploiement passera)"
if ! npx -y turbo run build --filter=@shomee/web; then
  echo
  echo "❌ Le build a échoué EN LOCAL — rien n'a été poussé (c'est le but : on"
  echo "   ne redéploie pas du cassé). Envoie-moi deploy-shomee.log, je corrige."
  read -r -p "Entrée pour fermer…"; exit 1
fi

echo; echo "━━━━━━━━ 3/3 — Push → Vercel (feat/monorepo) ━━━━━━━━"
if ! git push origin feat/proto-quartiers:feat/monorepo; then
  echo "❌ Le push a échoué — envoie-moi deploy-shomee.log."
  read -r -p "Entrée pour fermer…"; exit 1
fi

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Build local OK + push envoyé. Vercel déploie l'API (~2 min)."
echo "     Dis-le-moi : je vérifie d'ici que le déploiement passe au vert."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "Entrée pour fermer…"
