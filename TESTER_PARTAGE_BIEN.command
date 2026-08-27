#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  PARTAGE DE BIEN — prépare la base, puis lance le site en local pour
#  que tu testes le lien public d'un bien. Double-clique sur ce fichier.
#  Journal complet écrit dans partage-bien.log (lisible par Claude).
# ═══════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node introuvable — ouvre ce script depuis un Terminal où 'node -v' marche."
  read -r -p "Entrée pour fermer…"; exit 1
fi

LOG="partage-bien.log"; : > "$LOG"
exec > >(tee "$LOG") 2>&1
echo "Shomee — test du partage de bien, $(date '+%d/%m/%Y %H:%M') — node $(node -v)"

crit() { local t="$1"; shift; echo; echo "━━━━━━━━ $t ━━━━━━━━"
  if ! "$@"; then
    echo; echo "❌ ÉCHEC à cette étape — arrêt."
    echo "   Envoie le fichier partage-bien.log à Claude, il corrige."
    read -r -p "Entrée pour fermer…"; exit 1
  fi; }

crit "ÉTAPE 1/3 — Mise à jour de la base (2 colonnes + 1 table)" \
  bash -c 'cd apps/web && npx -y prisma db push'
crit "ÉTAPE 2/3 — Régénération du client Prisma" \
  bash -c 'cd apps/web && npx -y prisma generate'
crit "ÉTAPE 3/3 — Contrôle du code (doit finir sans aucune erreur)" \
  bash -c 'cd apps/web && npm run type-check'

echo
echo "━━━━━━━━ Démarrage du site en local ━━━━━━━━"
echo "  (laisse cette fenêtre ouverte pendant que tu testes)"
cd apps/web || exit 1
npm run dev &
DEV_PID=$!

BASE="http://localhost:3000"
KEY="shomee_test_kr3tz_0001"

# On attend que le serveur réponde (jusqu'à 90 s : le premier démarrage compile).
READY=0
for _ in $(seq 1 90); do
  if curl -s -o /dev/null "$BASE"; then READY=1; break; fi
  sleep 1
done

if [ "$READY" = 0 ]; then
  echo
  echo "⚠️  Le site n'a pas répondu à temps. Envoie partage-bien.log à Claude."
else
  # Premier bien publié de l'agence de démo, puis son lien de partage.
  BIEN=$(curl -s -H "Authorization: Bearer $KEY" "$BASE/api/agent/me/properties" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const p=(JSON.parse(d).properties||[]).filter(x=>x.statut==="PUBLISHED");process.stdout.write(p.length?p[0].id:"")}catch(e){process.stdout.write("")}})')

  URL=""
  if [ -n "$BIEN" ]; then
    URL=$(curl -s -X POST -H "Authorization: Bearer $KEY" "$BASE/api/properties/$BIEN/share-link" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).url||"")}catch(e){process.stdout.write("")}})')
  fi

  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✅ TOUT EST PRÊT."
  echo
  if [ -n "$URL" ]; then
    echo "  ① J'ouvre le lien public d'un de tes biens :"
    echo "       $URL"
    echo "     → la vidéo doit démarrer toute seule, sans le son."
    echo "     → tape dessus : le son s'active."
    echo "     → à la fin de la vidéo, une carte crème monte du bas."
    echo "       « Revoir la vidéo » la referme, la vidéo continue."
    echo
    open "$URL"
    sleep 2
  else
    echo "  ⚠️  Aucun bien publié trouvé : le lien public n'a pas pu être créé."
    echo "     Publie d'abord un bien depuis le tableau de bord."
    echo
  fi
  echo "  ② J'ouvre ton back-office :"
  echo "       $BASE/agent/biens"
  echo "     → clique « Modifier » sur un bien publié"
  echo "     → descends tout en bas : nouveau bloc « Partage »"
  echo "     → « Partager le bien » copie le lien (message « Lien copié »)"
  echo "     → l'interrupteur « Partage public » coupe le lien à distance"
  echo
  open "$BASE/agent/biens"
  echo "  Quand tu as fini : ferme simplement cette fenêtre."
  echo "  Rien n'est publié en ligne — tout se passe sur ton Mac."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

wait $DEV_PID
