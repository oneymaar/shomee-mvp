#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  POUSSER SHOMEE — envoie le travail en ligne et déclenche le déploiement
#  Double-clique sur ce fichier. Rien d'autre à faire.
#  Journal écrit dans pousser.log (lisible par Claude).
# ═══════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

LOG="pousser.log"; : > "$LOG"
exec > >(tee "$LOG") 2>&1
echo "SHOMEE — envoi du $(date '+%d/%m/%Y à %H:%M')"
echo

# Les verrous git périmés bloquent tout : on les écarte avant de commencer.
for verrou in .git/index.lock .git/HEAD.lock; do
  if [ -e "$verrou" ]; then
    mkdir -p _to_delete/verrous
    mv "$verrou" "_to_delete/verrous/$(basename "$verrou").$(date +%s)" 2>/dev/null \
      && echo "· verrou git périmé écarté ($verrou)"
  fi
done

BRANCHE="$(git rev-parse --abbrev-ref HEAD)"
echo "· branche courante : $BRANCHE"
echo

echo "━━━━━━━━ Ce qui part ━━━━━━━━"
if git log --oneline "origin/$BRANCHE..HEAD" 2>/dev/null | grep -q .; then
  git log --oneline "origin/$BRANCHE..HEAD"
else
  echo "(rien de nouveau — tout est déjà en ligne)"
fi
echo

echo "━━━━━━━━ Envoi ━━━━━━━━"
git push origin "$BRANCHE" || { echo; echo "❌ Échec de l'envoi. Envoie-moi pousser.log."; read -r -p "Entrée pour fermer…"; exit 1; }
# feat/monorepo est la branche que lisent l'app mobile ET le back-office.
git push origin "$BRANCHE:feat/monorepo" || { echo; echo "❌ Échec sur feat/monorepo. Envoie-moi pousser.log."; read -r -p "Entrée pour fermer…"; exit 1; }

echo
echo "✅ Envoyé. Vercel construit la nouvelle version — compte environ 2 minutes."
echo
echo "IMPORTANT — pour VOIR les changements :"
echo "  une page déjà ouverte garde son ancien code tant qu'on ne la recharge pas."
echo "  · Safari / Chrome : Cmd + Maj + R"
echo "  · application ajoutée à l'écran d'accueil : ferme-la complètement, puis rouvre"
echo "  · sinon, le bandeau « Nouvelle version — Recharger » apparaît tout seul en haut"
echo
echo "Back-office : https://shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app/agent/biens"
echo
read -r -p "Entrée pour fermer…"
