#!/usr/bin/env python3
"""Pré-traitement d'un album photo avant montage : définition, bordures parasites, orientation.

Garantit : chaque photo d'un album passée par ce contrôle est signalée si sa définition est
insuffisante pour un plein écran 1080p, si elle porte des bandes uniformes sombres ou claires en
bord d'image, ou si son orientation EXIF n'a pas été appliquée — jamais un recadrage silencieux.
Vérifier : python3 verificateurs/photos-sources.py --a-sec

Usage :
  python3 verificateurs/photos-sources.py <album_dir> [--min-cote 1100]
Sans Pillow installé : message clair sur stderr, code 2. HEIC : signalé « à convertir ».
"""
import os, sys

MIN_COTE_DEFAUT = 1100

# ── fonctions pures ──────────────────────────────────────────────────────────

def _uniforme(ligne, seuil_sombre=16, seuil_clair=239):
    return all(p < seuil_sombre for p in ligne) or all(p > seuil_clair for p in ligne)

def _profondeur(sequence):
    n = 0
    for ligne in sequence:
        if _uniforme(ligne):
            n += 1
        else:
            break
    return n

def bandes(matrice_gris, marge_pct=2.0):
    """Bords ('haut','bas','gauche','droite') portant une bordure uniforme sombre/claire de plus
    de `marge_pct` % du côté correspondant. matrice_gris : liste de listes d'entiers 0-255."""
    h = len(matrice_gris)
    w = len(matrice_gris[0]) if h else 0
    if not h or not w:
        return []
    colonnes = list(zip(*matrice_gris))
    resultat = []
    if h and _profondeur(matrice_gris) / h * 100 > marge_pct:
        resultat.append("haut")
    if h and _profondeur(list(reversed(matrice_gris))) / h * 100 > marge_pct:
        resultat.append("bas")
    if w and _profondeur(colonnes) / w * 100 > marge_pct:
        resultat.append("gauche")
    if w and _profondeur(list(reversed(colonnes))) / w * 100 > marge_pct:
        resultat.append("droite")
    return resultat

def verdict(largeur, hauteur, bandes_detectees, min_cote=MIN_COTE_DEFAUT):
    recos = []
    if max(largeur, hauteur) < min_cote:
        recos.append("petit format ou super-résolution non générative (aucun visage réinventé)")
    if bandes_detectees:
        recos.append("recadrer")
    return recos

def a_sec():
    n = 0
    claire = [255] * 10
    sombre = [3] * 10
    ordinaire = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170]
    matrice_sans_bande = [ordinaire for _ in range(10)]
    assert bandes(matrice_sans_bande) == []; n += 1
    matrice_bande_haut = [sombre] * 3 + [ordinaire for _ in range(7)]
    assert bandes(matrice_bande_haut) == ["haut"]; n += 1
    matrice_bande_bas = [ordinaire for _ in range(7)] + [claire] * 3
    assert bandes(matrice_bande_bas) == ["bas"]; n += 1
    assert _uniforme(sombre) is True and _uniforme(ordinaire) is False; n += 1
    assert verdict(800, 600, []) == ["petit format ou super-résolution non générative (aucun visage réinventé)"]; n += 1
    assert verdict(1920, 1080, []) == []; n += 1
    assert verdict(1920, 1080, ["haut"]) == ["recadrer"]; n += 1
    assert verdict(800, 600, ["bas"]) == \
        ["petit format ou super-résolution non générative (aucun visage réinventé)", "recadrer"]; n += 1
    print(f"a-sec : {n} cas OK")
    return 0

# ── mode réel ────────────────────────────────────────────────────────────────

def dit(ok, code, msg, echecs):
    print(f"{'OK    ' if ok else 'ÉCHEC '} {code:4s} {msg}")
    if not ok:
        echecs.append(code)

def orientation_a_corriger(image):
    ex = image.getexif()
    return ex.get(0x0112, 1) != 1  # 0x0112 = Orientation ; 1 = déjà normale

def analyser(chemin, min_cote):
    from PIL import Image
    with Image.open(chemin) as im:
        largeur, hauteur = im.size
        gris = im.convert("L")
        pixels = list(gris.getdata())
        matrice = [pixels[y * largeur:(y + 1) * largeur] for y in range(hauteur)]
        a_corriger = orientation_a_corriger(im)
    return largeur, hauteur, bandes(matrice), a_corriger

def main():
    argv = sys.argv[1:]
    if not argv or "--help" in argv:
        print(__doc__)
        return 0
    if "--a-sec" in argv:
        return a_sec()

    positionnels = [a for a in argv if not a.startswith("--")]
    if not positionnels:
        print(__doc__)
        return 0
    album = positionnels[0]
    min_cote = MIN_COTE_DEFAUT
    if "--min-cote" in argv:
        min_cote = int(argv[argv.index("--min-cote") + 1])
    if not os.path.isdir(album):
        print(f"répertoire absent : {album}", file=sys.stderr)
        return 2

    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("Pillow introuvable : installer Pillow pour l'analyse réelle des photos.", file=sys.stderr)
        return 2

    echecs = []
    fichiers = sorted(os.listdir(album))
    for nom in fichiers:
        bas = nom.lower()
        chemin = os.path.join(album, nom)
        if bas.endswith(".heic"):
            dit(False, "CONV", f"{nom} : HEIC à convertir en JPEG", echecs)
            continue
        if not bas.endswith((".jpg", ".jpeg", ".png")):
            continue
        largeur, hauteur, bnd, a_corriger = analyser(chemin, min_cote)
        dit(max(largeur, hauteur) >= min_cote, "DEF", f"{nom} : {largeur}×{hauteur}", echecs)
        dit(not bnd, "BND", f"{nom} : bordure(s) {', '.join(bnd) or 'aucune'}", echecs)
        dit(not a_corriger, "ORI", f"{nom} : orientation EXIF", echecs)

    if echecs:
        print(f"{len(echecs)} contrôle(s) en échec : {', '.join(sorted(set(echecs)))}")
        return 1
    print("tous les contrôles passent")
    return 0

if __name__ == "__main__":
    sys.exit(main())
