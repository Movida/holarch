#!/usr/bin/env python3
"""Contrôle qualité d'un rendu vidéo : durée, conteneur, loudness, silences, noir/blanc, gels.

Garantit : un rendu vidéo passé par ce contrôle respecte la durée attendue, le conteneur cible
(1920×1080, H.264, AAC, faststart), la loudness EBU R128, l'absence de silences longs, de
passages au noir/blanc parasites et de plans figés trop longs.
Vérifier : python3 verificateurs/qc.py --a-sec

Usage :
  python3 verificateurs/qc.py <fichier.mp4> [--attendu S] [--planche [--pas N]]
Sans ffmpeg/ffprobe installés : message clair sur stderr, code 2.
"""
import os, pathlib, re, subprocess, sys

# ── fonctions pures (parseurs et décisions) ─────────────────────────────────
def ecart_duree_pct(duree, attendu): return abs(duree - attendu) / attendu * 100 if attendu else 0.0

def verif_conteneur(largeur, hauteur, codec_v, codec_a):
    return {"definition": (largeur, hauteur) == (1920, 1080), "video": codec_v == "h264", "audio": codec_a == "aac"}

def faststart_ok(atomes):  # moov doit précéder mdat
    try:
        return atomes.index("moov") < atomes.index("mdat")
    except ValueError:
        return False

def parse_loudnorm(stderr):  # input_i/input_tp du bloc JSON de loudnorm, sans dépendre du module json
    mi = re.search(r'"input_i"\s*:\s*"?(-?[\d.]+)"?', stderr)
    mtp = re.search(r'"input_tp"\s*:\s*"?(-?[\d.]+)"?', stderr)
    return (float(mi.group(1)), float(mtp.group(1))) if mi and mtp else None

def verif_loudness(i, tp): return (-18 <= i <= -14), (tp <= -1.0)
def parse_silences(stderr): return [float(x) for x in re.findall(r"silence_duration: ([\d.]+)", stderr)]
def silences_longs(durees, seuil=1.5): return [d for d in durees if d > seuil]
def parse_noirs(stderr): return [(float(s), float(e)) for s, e in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", stderr)]
def hors_bords(segments, duree, marge=3.0): return [(s, e) for s, e in segments if s > marge and e < duree - marge]
def parse_luma(stderr): return [(float(t), float(y)) for t, y in re.findall(r"pts_time:([\d.]+).*?YAVG=([\d.]+)", stderr, re.S)]

def segments_blancs(luma, seuil=249.0, duree_min=0.5):  # plages continues au-dessus du seuil (blanc quasi pur)
    segs, debut, prec = [], None, None
    for t, y in luma:
        if y >= seuil:
            debut = t if debut is None else debut
        else:
            if debut is not None and prec - debut >= duree_min:
                segs.append((debut, prec))
            debut = None
        prec = t
    if debut is not None and prec - debut >= duree_min:
        segs.append((debut, prec))
    return segs

def parse_gels(stderr): return [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", stderr)]

def dit(ok, code, msg, echecs):
    print(f"{'OK    ' if ok else 'ÉCHEC '} {code:4s} {msg}")
    if not ok:
        echecs.append(code)

def lire_atomes(chemin):  # boîtes top-level d'un mp4, pour vérifier que moov précède mdat (faststart)
    noms = []
    with open(chemin, "rb") as fh:
        while True:
            entete = fh.read(8)
            if len(entete) < 8:
                break
            taille = int.from_bytes(entete[:4], "big")
            noms.append(entete[4:8].decode("latin1", "replace"))
            if taille < 8:
                break
            fh.seek(taille - 8, 1)
    return noms

def ffmpeg_filtre(ffmpeg, chemin, option, filtre):
    return subprocess.run([ffmpeg, "-nostats", "-i", chemin, option, filtre, "-f", "null", "-"],
                           capture_output=True, text=True).stderr

def which(nom):  # équivalent minimal de shutil.which (pas de dépendance à shutil, absent de certains environnements)
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = pathlib.Path(d) / nom
        if p.is_file() and os.access(p, os.X_OK):
            return str(p)
    return None

def sonder(ffprobe, chemin):  # (stream vidéo, stream audio, durée), sortie key=value, sans module json
    r = subprocess.run([ffprobe, "-v", "error", "-show_entries",
                        "stream=codec_type,codec_name,width,height:format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=0", chemin], capture_output=True, text=True)
    streams, courant, duree = [], None, 0.0
    for ligne in r.stdout.splitlines():
        if "=" not in ligne:
            continue
        k, v = ligne.split("=", 1)
        if k == "codec_type":
            courant = {"codec_type": v}; streams.append(courant)
        elif k == "duration":
            duree = float(v) if v != "N/A" else 0.0
        elif courant is not None:
            courant[k] = v
    v = next((s for s in streams if s.get("codec_type") == "video"), {})
    a = next((s for s in streams if s.get("codec_type") == "audio"), {})
    return v, a, duree

def a_sec():
    n = 0
    assert ecart_duree_pct(415, 415) <= 3 and ecart_duree_pct(88, 415) > 3; n += 2
    assert all(verif_conteneur(1920, 1080, "h264", "aac").values()); n += 1
    assert not any(verif_conteneur(1280, 720, "vp9", "opus").values()); n += 1
    assert faststart_ok(["ftyp", "moov", "mdat"]) and not faststart_ok(["ftyp", "mdat", "moov"]); n += 2
    bon = parse_loudnorm('{"input_i" : "-15.8", "input_tp" : "-1.3"}')
    mauvais = parse_loudnorm('{"input_i" : "-9.0", "input_tp" : "0.5"}')
    assert verif_loudness(*bon) == (True, True) and verif_loudness(*mauvais) == (False, False); n += 2
    assert silences_longs(parse_silences("silence_duration: 0.4")) == []; n += 1
    assert len(silences_longs(parse_silences("silence_duration: 2.1"))) == 1; n += 1
    assert hors_bords(parse_noirs("black_start:1.0 black_end:1.5"), 60) == []; n += 1
    assert len(hors_bords(parse_noirs("black_start:30.0 black_end:31.0"), 60)) == 1; n += 1
    luma_ok = "pts_time:0.5 x\nlavfi.signalstats.YAVG=120.000000\n"
    luma_ko = "pts_time:30.0 x\nlavfi.signalstats.YAVG=253.000000\npts_time:30.6 x\nlavfi.signalstats.YAVG=254.000000\n"
    assert segments_blancs(parse_luma(luma_ok)) == [] and len(hors_bords(segments_blancs(parse_luma(luma_ko)), 60)) == 1
    n += 2
    assert parse_gels("rien ici") == [] and parse_gels("freeze_start: 12.0") == [12.0]; n += 2
    print(f"a-sec : {n} cas OK")
    return 0

# ── mode réel ────────────────────────────────────────────────────────────────
def controles_conteneur(v, a, largeur, hauteur, chemin, echecs):
    c = verif_conteneur(largeur, hauteur, v.get("codec_name"), a.get("codec_name"))
    dit(c["definition"], "D3", f"définition 1920×1080 (vu {largeur}×{hauteur})", echecs)
    dit(c["video"], "D3", f"vidéo H.264 (vu {v.get('codec_name')})", echecs)
    dit(c["audio"], "D3", f"audio AAC (vu {a.get('codec_name')})", echecs)
    dit(faststart_ok(lire_atomes(chemin)), "D3", "faststart (moov avant mdat)", echecs)

def controles_video(ffmpeg, chemin, duree, echecs):
    noirs = hors_bords(parse_noirs(ffmpeg_filtre(ffmpeg, chemin, "-vf", "blackdetect=d=0.5:pix_th=0.00")), duree)
    dit(not noirs, "A10", f"{len(noirs)} passage(s) au noir pur en cours de film", echecs)
    lum = ffmpeg_filtre(ffmpeg, chemin, "-vf", "signalstats,metadata=print")
    blancs = hors_bords(segments_blancs(parse_luma(lum)), duree)
    dit(not blancs, "A10", f"{len(blancs)} passage(s) au blanc pur en cours de film", echecs)
    gels = parse_gels(ffmpeg_filtre(ffmpeg, chemin, "-vf", "freezedetect=n=-60dB:d=4"))
    dit(not gels, "A3", f"{len(gels)} plan(s) figé(s) plus de 4 s", echecs)

def controles_audio(ffmpeg, chemin, echecs):
    pl = parse_loudnorm(ffmpeg_filtre(ffmpeg, chemin, "-af", "loudnorm=I=-16:TP=-1:print_format=json"))
    if pl:
        ok_i, ok_tp = verif_loudness(*pl)
        dit(ok_i, "C1", f"loudness {pl[0]:.1f} LUFS (cible −16 ± 2)", echecs)
        dit(ok_tp, "C1", f"crête vraie {pl[1]:.1f} dBTP (max −1,0)", echecs)
    longs = silences_longs(parse_silences(ffmpeg_filtre(ffmpeg, chemin, "-af", "silencedetect=n=-45dB:d=1.5")))
    dit(not longs, "C4", f"{len(longs)} silence(s) de plus de 1,5 s", echecs)

def planche(ffmpeg, chemin, duree, pas):  # une image toutes les `pas` s, pour relecture visuelle (sans PIL)
    dest = pathlib.Path(chemin).parent / (pathlib.Path(chemin).stem + "-relecture")
    dest.mkdir(exist_ok=True)
    for t in range(1, max(int(duree), 1), pas):
        subprocess.run([ffmpeg, "-v", "error", "-y", "-ss", str(t), "-i", chemin, "-frames:v", "1",
                         str(dest / f"t{t:04d}.jpg")], check=False)
    print(f"images de relecture extraites dans {dest}")

def main():
    argv = sys.argv[1:]
    if not argv or "--help" in argv:
        print(__doc__); return 0
    if "--a-sec" in argv:
        return a_sec()
    positionnels = [a for a in argv if not a.startswith("--")]
    if not positionnels:
        print(__doc__); return 0
    chemin, opts, i = positionnels[0], {}, 0
    while i < len(argv):
        x = argv[i]
        if x == "--attendu" and i + 1 < len(argv):
            opts["attendu"] = float(argv[i + 1]); i += 1
        elif x == "--pas" and i + 1 < len(argv):
            opts["pas"] = int(argv[i + 1]); i += 1
        elif x == "--planche":
            opts["planche"] = True
        i += 1

    ffmpeg, ffprobe = which("ffmpeg"), which("ffprobe")
    if not ffmpeg or not ffprobe:
        print("ffmpeg/ffprobe introuvable : installer ffmpeg pour le contrôle réel.", file=sys.stderr); return 2
    if not pathlib.Path(chemin).exists():
        print(f"fichier absent : {chemin}", file=sys.stderr); return 2

    echecs = []
    v, a, duree = sonder(ffprobe, chemin)
    largeur = int(v["width"]) if v.get("width", "N/A") != "N/A" else None
    hauteur = int(v["height"]) if v.get("height", "N/A") != "N/A" else None
    controles_conteneur(v, a, largeur, hauteur, chemin, echecs)
    if "attendu" in opts:
        ec = ecart_duree_pct(duree, opts["attendu"])
        dit(ec <= 3, "D1", f"durée {duree:.0f} s pour {opts['attendu']:.0f} s attendues (écart {ec:.1f} %)", echecs)
    if a:
        controles_audio(ffmpeg, chemin, echecs)
    controles_video(ffmpeg, chemin, duree, echecs)
    if opts.get("planche"):
        planche(ffmpeg, chemin, duree, opts.get("pas", 20))

    if echecs:
        print(f"{len(echecs)} contrôle(s) en échec : {', '.join(sorted(set(echecs)))}")
        return 1
    print("tous les contrôles passent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
