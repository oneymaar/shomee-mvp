#!/bin/bash
# SHOMEE — récupère les visites qui composeront le fond de l'écran d'accueil.
#
# Double-clique ce fichier. Il télécharge 28 extraits de 5 secondes dans
# `maquettes/clips-hd/`, en 720 px de large — assez de définition pour que les
# tuiles restent nettes une fois le fond rendu en 1080p.
#
# (La première version tirait des extraits en 360 px : la sortie était floue,
# aucun réglage d'encodage ne pouvait le rattraper.)
#
# Pourquoi ce script existe : l'environnement de Claude n'a pas accès à
# res.cloudinary.com. Ton Mac, si.

cd "$(dirname "$0")" || exit 1
DEST="maquettes/clips-hd"
CLOUD="https://res.cloudinary.com/dcysksoo3/video/upload"
# so_1 : on saute la première seconde (souvent un fondu au noir).
# du_5 : 5 s pile — c'est ce qui rend la boucle finale sans couture.
# w_720 + q_auto:best : la source doit être PLUS fine que la tuile finale.
TR="so_1,du_5,w_720,ar_9:16,c_fill,q_auto:best,ac_none,vc_h264"

IDS=(
  ffecc53cab0a e1a082b328ac f7a55c3dea52 8966cca41c83 ca1fdf19c51f
  d5bf15989ecb 6dcbd9ebf5ab 2f933eec7a52 105e14608ebb 94ceb14af5a4
  9e850bc11b59 e4de48038078 190595eb866b 9d43144127dc f99bc3e50bfc
  f2f7b9a5f606 a0a9b104cbb4 ce86aeddb357 b02f65ede144 93e65b33567f
  af54859c1786 68813a4fcc1b e7c72ecb3b03 840461e1e2bf 60b1cfecd4a8
  fa081dd38f57 3d220a2aac61 9eb2d2f46dfd
)

mkdir -p "$DEST"
echo "SHOMEE — visites en HD pour le fond d'accueil"
echo "→ ${#IDS[@]} extraits de 5 s en 720 px vers $DEST"
echo "  (Cloudinary ré-encode à la première demande : comptez quelques"
echo "   secondes par clip, et ~40 Mo au total)"
echo

ok=0; ko=0; i=0
for id in "${IDS[@]}"; do
  i=$((i+1))
  out="$DEST/$(printf '%02d' $i)-$id.mp4"
  printf '[%2d/%d] %s ' "$i" "${#IDS[@]}" "$id"
  if [ -s "$out" ]; then echo "déjà là"; ok=$((ok+1)); continue; fi
  code=$(curl -sS -w '%{http_code}' -o "$out" --max-time 300 "$CLOUD/$TR/shomee/videos/$id.mp4")
  if [ "$code" = "200" ] && [ -s "$out" ]; then
    echo "✓ $(du -h "$out" | cut -f1)"; ok=$((ok+1))
  else
    echo "✗ (HTTP $code)"; rm -f "$out"; ko=$((ko+1))
  fi
done

echo
echo "Terminé : $ok téléchargés, $ko en échec."
[ $ok -gt 0 ] && echo "Poids total : $(du -sh "$DEST" | cut -f1)"
echo
echo "Tu peux revenir dans Cowork : dis à Claude que les clips HD sont prêts."
echo "(Cette fenêtre peut être fermée.)"
