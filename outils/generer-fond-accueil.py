#!/usr/bin/env python3
"""
Génère le fond animé de l'écran d'accueil SHOMEE : UNE seule vidéo de 30 s,
bouclable, qui reproduit la mosaïque de la maquette `shomee-accueil-video.html`.

Pourquoi une seule vidéo : iOS plafonne le nombre de décodeurs H.264 simultanés
(~4 sur un appareil modeste). Un mur de N lecteurs est donc ingérable en natif.
Ici, un seul lecteur, un seul fichier, poids maîtrisé, et le rendu ne dépend plus
de l'appareil.

Réglages repris de la maquette (validés par Olivier) :
  grille verticale · tuiles 9:16 de taille égale · gap fixe · défilement continu
  lent · débordement latéral léger · perspective « crawl » · interstices beige
  · socle beige (dessiné par l'app, pas ici) · fondu du haut en gris chaud.

La boucle est PARFAITE par construction :
  - chaque clip source dure exactement CLIP_S secondes et DUREE % CLIP_S == 0 ;
  - chaque colonne défile d'exactement une demi-pile (sa période) sur DUREE.

Usage :
    python3 generer-fond-accueil.py --clips <dossier de .mp4> --out fond.mp4
    python3 generer-fond-accueil.py --clips ./clips --out fond.mp4 --preview 6
"""

import argparse, math, os, shlex, subprocess, sys, tempfile
from pathlib import Path

# ---------------------------------------------------------------- paramètres

DUREE      = 30          # s — durée de la boucle
CLIP_S     = 5           # s — durée d'un clip source (DUREE doit en être un multiple)
FPS        = 25
OUT_W      = 810         # px — largeur de sortie (cover sur tous les iPhone)
OUT_H      = 1752        # px — ratio ≈ 1:2,16, celui d'un iPhone récent

# Repère de la maquette : écran utile de 368 px de large, 844 de haut.
REF_W, REF_H = 368, 844
SCALE = OUT_W / REF_W

TILE_W_REF = 116         # « Grande » dans la maquette
GAP_REF    = 8
BLEED      = 0.55        # « Léger »
# « Crawl »
RX_DEG     = 34
PERSP      = 820         # px, dans le repère de la maquette
P_ORIGIN_Y = 0.06        # perspective-origin: 50% 6% → l'œil est près du HAUT
W_MUL      = 1.45
# H_MUL n'est plus une constante : la hauteur de mur est calculée pour que le
# sommet projeté sorte tout juste par le haut de l'écran (voir hauteur_utile).
MARGE_HAUT = 120         # px de mur projeté au-delà du bord haut, par sécurité

INTERSTICE = "0xFDF5F2"  # fond visible entre les tuiles (beige)
LOINTAIN   = "0x544C47"  # gris chaud du fondu haut
RADIUS_REF = 12          # arrondi des tuiles


def px(v):
    """Repère maquette → pixels de sortie, arrondi pair (exigence H.264)."""
    return int(round(v * SCALE / 2) * 2)


def _proj_y(dy):
    """
    Projection CSS exacte d'un point du mur situé dy px AU-DESSUS de sa base
    (dy ≤ 0), la base étant calée sur le bas de l'écran.

    rotateX(θ) autour de la base : y' = dy·cosθ, z = dy·sinθ (dy<0 → z<0, ça
    s'éloigne). Puis la perspective CSS, dont l'œil est en (50 %, P_ORIGIN_Y) —
    ce détail change tout : avec l'œil près du haut, le mur ne converge pas vers
    le centre de l'écran mais sort par le haut du cadre.
    """
    t = math.radians(RX_DEG)
    P = PERSP * SCALE
    oy = P_ORIGIN_Y * OUT_H
    f = P / (P - dy * math.sin(t))            # dy ≤ 0 → f ≤ 1
    y = oy + (OUT_H + dy * math.cos(t) - oy) * f
    return y, f


def hauteur_utile():
    """Hauteur de mur juste suffisante pour que le sommet projeté sorte du cadre."""
    h = OUT_H
    while h < OUT_H * 4:
        y, _ = _proj_y(-h)
        if y <= -MARGE_HAUT:
            return h
        h += 40
    return h


def geometrie():
    """Reprend, à l'échelle de sortie, exactement le calcul du JS de la maquette."""
    tile_w = TILE_W_REF * SCALE
    over   = BLEED * tile_w
    wall_w = OUT_W + 2 * over
    gap    = px(GAP_REF)
    cols   = max(1, round((wall_w + gap) / (tile_w + gap)))
    left   = -over - tile_w * 0.14

    wall_w2 = wall_w * W_MUL
    left2   = left - (wall_w2 - wall_w) / 2
    cols2   = round(cols * W_MUL)

    tw = int(round(((wall_w2 - (cols2 - 1) * gap) / cols2) / 2) * 2)
    th = int(round((tw * 16 / 9) / 2) * 2)
    per_col = math.ceil(hauteur_utile() / (th + gap)) + 1

    return dict(tw=tw, th=th, gap=gap, cols=cols2, per_col=per_col,
                wall_w=int(cols2 * (tw + gap) - gap), wall_h=int(per_col * (th + gap) - gap),
                left=int(round(left2)))


def projection(g):
    """
    Les 4 coins du mur projetés, en repère ÉCRAN (l'origine est le coin haut
    gauche du téléphone ; des valeurs négatives sont normales, le mur déborde).
    La base ne bouge pas (dy = 0 → facteur 1), seul le sommet se contracte.
    """
    ox = OUT_W / 2
    h  = g["wall_h"]
    x0, x1 = float(g["left"]), float(g["left"] + g["wall_w"])
    y_top, f = _proj_y(-h)
    return dict(f_top=f, y_top=y_top,
                tl=(ox + (x0 - ox) * f, y_top), tr=(ox + (x1 - ox) * f, y_top),
                bl=(x0, float(OUT_H)),          br=(x1, float(OUT_H)))


def masque_arrondi(path, w, h, r):
    """PNG blanc à coins arrondis — sert d'alpha pour arrondir les tuiles."""
    from PIL import Image, ImageDraw
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    im.save(path)


def voile(path, w, h):
    """
    Dégradés fixes, cuits dans la vidéo : fondu du lointain en haut + halo doux
    derrière le logo. Le socle bas n'est PAS dessiné ici — c'est de l'interface,
    l'app le pose en natif (sinon impossible d'ajuster les boutons ensuite).
    """
    from PIL import Image
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pix = im.load()
    top = tuple(int(LOINTAIN[2:][i:i + 2], 16) for i in (0, 2, 4))
    fin = int(h * 0.31)
    for y in range(h):
        a = 0
        if y < fin:                                   # fondu du lointain
            t = y / fin
            a = int(255 * 0.86 * max(0.0, 1 - t) ** 1.7)
        for x in range(w):
            pix[x, y] = (top[0], top[1], top[2], a)

    # halo sombre derrière le logo (ellipse douce), pour que le blanc tienne
    cx, cy = w / 2, h * 0.34
    rx, ry = w * 0.76, h * 0.16
    for y in range(int(cy - ry), int(cy + ry)):
        if not (0 <= y < h):
            continue
        for x in range(w):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d >= 1:
                continue
            a = int(255 * 0.42 * (1 - d) ** 1.3)
            r0, g0, b0, a0 = pix[x, y]
            na = min(255, a0 + a)
            pix[x, y] = (28, 22, 19, na) if a > a0 else (r0, g0, b0, na)
    im.save(path)


def normaliser(clips, dossier):
    """
    Ramène chaque clip à EXACTEMENT CLIP_S secondes.

    Sans cela, un clip plus court (Cloudinary rend ce qu'il a) donnerait une
    période qui ne divise pas DUREE, et la boucle finale sauterait visiblement.
    """
    out_dir = Path(dossier); out_dir.mkdir(parents=True, exist_ok=True)
    normalises = []
    for c in clips:
        d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "default=nw=1:nk=1", str(c)],
                           capture_output=True, text=True).stdout.strip()
        dur = float(d) if d else 0
        dst = out_dir / Path(c).name
        if abs(dur - CLIP_S) < 0.06 and dur > 0:
            if not dst.exists():
                dst.write_bytes(Path(c).read_bytes())
        else:
            print(f"   {Path(c).name}: {dur:.2f} s → rebouclé à {CLIP_S} s")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1",
                            "-i", str(c), "-t", str(CLIP_S), "-c:v", "libx264",
                            "-crf", "20", "-preset", "veryfast", "-an",
                            "-pix_fmt", "yuv420p", str(dst)], check=True)
        normalises.append(dst)
    return normalises


def construire(clips, out, preview=None, garder=None, max_mo=4.0, crf0=28):
    g = geometrie()
    p = projection(g)
    duree = preview or DUREE
    tw, th, gap, cols, per_col = g["tw"], g["th"], g["gap"], g["cols"], g["per_col"]

    tmp = Path(tempfile.mkdtemp(prefix="shomee-fond-"))
    m_path, v_path = tmp / "masque.png", tmp / "voile.png"
    masque_arrondi(m_path, tw, th, px(RADIUS_REF))
    voile(v_path, OUT_W, OUT_H)

    n = len(clips)
    inputs, fc = [], []
    for c in clips:
        inputs += ["-stream_loop", "-1", "-t", str(duree), "-i", str(c)]
    # `-loop 1` est indispensable : sans lui, une entrée PNG ne fournit qu'UNE
    # frame et le masque comme le voile ne s'appliquent qu'à la première image
    # de la vidéo — le reste sort sans fondu, ce qui ne se voit qu'à l'usage.
    inputs += ["-loop", "1", "-t", str(duree), "-i", str(m_path),
               "-loop", "1", "-t", str(duree), "-i", str(v_path)]
    i_mask, i_veil = n, n + 1

    # 1. Une tuile = clip recadré 9:16, coins arrondis, puis marge droite/bas = gap.
    k = 0
    for c in range(cols):
        for r in range(per_col):
            src = (c * 7 + r * 3) % n          # répartition sans motif visible
            fc.append(
                f"[{src}:v]scale={tw}:{th}:force_original_aspect_ratio=increase,"
                f"crop={tw}:{th},setsar=1,format=rgba[t{k}s];"
                f"[t{k}s][{i_mask}:v]alphamerge[t{k}m];"
                f"[t{k}m]pad={tw+gap}:{th+gap}:0:0:color=#00000000[t{k}]"
            )
            k += 1

    # 2. Une colonne = pile verticale, DOUBLÉE : le crop peut alors défiler d'une
    #    demi-hauteur sans jamais rencontrer de vide → boucle sans couture.
    col_h = per_col * (th + gap)
    for c in range(cols):
        ids = "".join(f"[t{c*per_col+r}]" for r in range(per_col))
        fc.append(f"{ids}vstack=inputs={per_col}[p{c}]")
        fc.append(f"[p{c}]split=2[p{c}a][p{c}b];[p{c}a][p{c}b]vstack=inputs=2[d{c}]")
        # sens alterné ; la période est exactement `duree` → boucle parfaite
        y = f"mod(t/{duree}*{col_h},{col_h})" if c % 2 == 0 else f"{col_h}-mod(t/{duree}*{col_h},{col_h})"
        fc.append(f"[d{c}]crop={tw+gap}:{col_h}:0:'{y}':exact=1[c{c}]")

    # 3. Les colonnes côte à côte (le gap est déjà dans le pad de chaque tuile).
    ids = "".join(f"[c{c}]" for c in range(cols))
    fc.append(f"{ids}hstack=inputs={cols}[wall]")

    # 4. Bascule du plan. Le mur est d'abord aplati sur un fond couleur
    #    interstice (sinon les gaps transparents virent au noir à la projection),
    #    puis `perspective` envoie les 4 coins de CETTE image sur le trapèze.
    #    Les coins sont donc exprimés dans le repère du mur, pas de l'écran.
    ox_, oy_ = -g["left"], col_h - OUT_H
    co = {k: (p[k][0] + ox_, p[k][1] + oy_) for k in ("tl", "tr", "bl", "br")}
    fc.append(f"color=c={INTERSTICE}:s={g['wall_w']+gap}x{col_h}:d={duree}:r={FPS}[bg]")
    fc.append("[bg][wall]overlay=0:0:format=auto,format=rgba[flat]")
    fc.append(
        f"[flat]perspective="
        f"x0={co['tl'][0]:.1f}:y0={co['tl'][1]:.1f}:"
        f"x1={co['tr'][0]:.1f}:y1={co['tr'][1]:.1f}:"
        f"x2={co['bl'][0]:.1f}:y2={co['bl'][1]:.1f}:"
        f"x3={co['br'][0]:.1f}:y3={co['br'][1]:.1f}:"
        f"sense=destination:eval=init[persp]"
    )

    # 5. Cadrage écran : la base du mur est calée en bas, le mur déborde à gauche
    #    et à droite (coupes inégales, comme dans la maquette).
    fc.append(f"color=c={LOINTAIN}:s={OUT_W}x{OUT_H}:d={duree}:r={FPS}[canvas]")
    fc.append(f"[canvas][persp]overlay={g['left']}:{OUT_H - col_h}:format=auto[scene]")
    fc.append(f"[scene][{i_veil}:v]overlay=0:0:format=auto,fps={FPS},format=yuv420p[out]")

    filtre = ";".join(fc)
    (tmp / "filtre.txt").write_text(filtre)

    print(f"→ {cols} colonnes × {per_col} tuiles ({tw}×{th}, gap {gap})")
    print(f"→ mur {g['wall_w']}×{col_h}, décalé de {g['left']} px")
    print(f"→ perspective : sommet à {p['f_top']*100:.0f} % d'échelle, "
          f"projeté à y={p['y_top']:.0f} (hors cadre par le haut)")
    print(f"→ {duree} s à {FPS} fps, {OUT_W}×{OUT_H}\n")

    # L'asset est embarqué dans l'app : on vise un poids plafond. Le CRF monte
    # d'un cran tant qu'on dépasse — c'est un fond, personne ne compte les blocs.
    for crf in [c for c in (crf0, crf0 + 3, crf0 + 6, crf0 + 9) if c <= 40]:
        cmd = ["ffmpeg", "-y", *inputs,
               "-filter_complex_script", str(tmp / "filtre.txt"),
               "-map", "[out]", "-an", "-t", str(duree),
               "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
               "-crf", str(crf), "-preset", "slow", "-movflags", "+faststart",
               "-g", str(FPS * 2), str(out)]
        print(f"   encodage CRF {crf}…")
        r = subprocess.run(cmd, stderr=subprocess.PIPE, text=True)
        if r.returncode != 0:
            print(r.stderr[-4000:], file=sys.stderr)
            raise SystemExit("ffmpeg a échoué")
        mo = os.path.getsize(out) / 1e6
        print(f"   → {mo:.2f} Mo")
        if mo <= max_mo or crf == 37:
            break
        print(f"   au-dessus de la cible ({max_mo} Mo), on remonte le CRF")

    # Poster : l'app l'affiche le temps que le lecteur démarre (~100 ms), sinon
    # le premier écran de l'app clignote en gris.
    poster = str(Path(out).with_suffix(".jpg"))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out),
                    "-frames:v", "1", "-q:v", "4", poster], check=True)

    if garder:
        Path(garder).write_text(" ".join(shlex.quote(a) for a in cmd))
    return out, poster


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", required=True, help="dossier de .mp4 sources (5 s chacun)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--preview", type=int, help="durée réduite, pour itérer vite")
    ap.add_argument("--dump-cmd")
    ap.add_argument("--max-mo", type=float, default=4.0, help="poids plafond visé")
    ap.add_argument("--duree", type=int, help="durée de la boucle (multiple de la durée d'un clip)")
    ap.add_argument("--largeur", type=int, help="largeur de sortie en px")
    ap.add_argument("--fps", type=int)
    ap.add_argument("--crf", type=int, default=28, help="CRF de départ")
    a = ap.parse_args()

    if a.duree:
        if a.duree % CLIP_S:
            raise SystemExit(f"--duree doit etre un multiple de {CLIP_S} s (boucle sans couture)")
        globals()["DUREE"] = a.duree
    if a.largeur:
        globals()["OUT_W"] = a.largeur
        globals()["OUT_H"] = int(round(a.largeur * 1752 / 810 / 2) * 2)
        globals()["SCALE"] = a.largeur / REF_W
    if a.fps:
        globals()["FPS"] = a.fps

    clips = sorted(Path(a.clips).glob("*.mp4"))
    if not clips:
        raise SystemExit(f"aucun .mp4 dans {a.clips}")
    print(f"→ {len(clips)} clips, vérification des durées…")
    clips = normaliser(clips, Path(a.clips).parent / "clips-normalises")
    out, poster = construire(clips, a.out, a.preview, a.dump_cmd, a.max_mo, a.crf)
    print(f"\n✓ {out} — {os.path.getsize(out)/1e6:.2f} Mo")
    print(f"✓ {poster} — {os.path.getsize(poster)/1e3:.0f} Ko (image de démarrage)")
