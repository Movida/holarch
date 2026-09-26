#!/usr/bin/env python3
"""Garde de charge machine pour rendus lourds (ffmpeg, montage, super-résolution…).

Garantit : un rendu lourd lancé en arrière-plan ne fait jamais dépasser à la machine la charge ou
la mémoire limites — `setsid`/`nohup` protègent d'une fin de session, pas d'un redémarrage de la
machine faute de mémoire ou de charge : d'où cette garde, qui suspend puis reprend les rendus.
Vérifier : python3 verificateurs/garde-charge.py --a-sec

Usage :
  python3 verificateurs/garde-charge.py [--periode 4] [--max-charge X] [--ok-charge X]
      [--min-mem-mo N] [--ok-mem-mo N] [--garder N] [--motif REGEX] [--exclure REGEX] [--une-fois]
Boucle toutes les --periode secondes ; --une-fois : un seul tour (pour test réel).
"""
import os, re, signal, sys, time

MOTIF_DEFAUT = r"ffmpeg|render|rendu|montage|assembl"
EXCLURE_DEFAUT = r"claude|holarch|observe|garde-charge"

def correspond(cmd, motif, exclure):
    """Vrai si `cmd` (ligne de commande) correspond à `motif` et pas à `exclure`."""
    return bool(re.search(motif, cmd)) and not bool(re.search(exclure, cmd))


def decider(charge, mem_mo, rendus, params):
    """Cœur de la garde, pur : aucun signal envoyé ici.
    rendus : liste de (pid, démarrage, état) — état 'run' ou 'stop'.
    params : max_charge, ok_charge, min_mem_mo, ok_mem_mo, garder.
    Retourne une liste d'actions ('renice', pid) puis ('stop', pid)* ou ('cont', pid), jamais les deux."""
    ordre = sorted(rendus, key=lambda r: r[1])
    actions = [("renice", pid) for pid, _, _ in ordre]
    actifs = [r for r in ordre if r[2] == "run"]
    stoppes = [r for r in ordre if r[2] == "stop"]
    if charge > params["max_charge"] or mem_mo < params["min_mem_mo"]:
        for pid, _, _ in reversed(actifs[params["garder"]:]):
            actions.append(("stop", pid))
    elif charge < params["ok_charge"] and mem_mo > params["ok_mem_mo"] and stoppes:
        actions.append(("cont", stoppes[0][0]))
    return actions


def a_sec():
    n = 0
    assert correspond("ffmpeg -i in.mp4 out.mp4", MOTIF_DEFAUT, EXCLURE_DEFAUT) is True; n += 1
    assert correspond("node framework/bin/holarch-spawn.js concepteur", MOTIF_DEFAUT, EXCLURE_DEFAUT) is False; n += 1
    params = dict(max_charge=7.0, ok_charge=4.5, min_mem_mo=2500, ok_mem_mo=4500, garder=2)
    rendus = [(101, 10, "run"), (102, 20, "run"), (103, 30, "run"), (104, 40, "run")]
    a = decider(8.0, 3000, rendus, params)  # surcharge : au-delà de « garder », les plus récents d'abord
    assert [x for x in a if x[0] == "stop"] == [("stop", 104), ("stop", 103)]; n += 1
    a2 = decider(2.0, 3000, [(101, 10, "run"), (102, 20, "run")], params)  # mémoire sous le seuil « ok »
    assert not any(x[0] in ("stop", "cont") for x in a2); n += 1
    rendus_stop = [(101, 10, "run"), (102, 20, "stop"), (103, 30, "stop")]
    assert [x for x in decider(1.0, 6000, rendus_stop, params) if x[0] == "cont"] == [("cont", 102)]; n += 1
    assert decider(1.0, 6000, [], params) == []; n += 1
    print(f"a-sec : {n} cas OK")
    return 0


def loadavg():
    with open("/proc/loadavg") as fh:
        return float(fh.readline().split()[0])


def mem_disponible_mo():
    with open("/proc/meminfo") as fh:
        for ligne in fh:
            if ligne.startswith("MemAvailable"):
                return int(ligne.split()[1]) // 1024
    return 0


def lister_rendus(motif, exclure):
    """Processus de l'utilisateur courant dont la commande correspond à `motif` et pas à `exclure`."""
    uid, trouves = os.getuid(), []
    for nom in os.listdir("/proc"):
        if not nom.isdigit():
            continue
        try:
            if os.stat(f"/proc/{nom}").st_uid != uid:
                continue
            with open(f"/proc/{nom}/cmdline", "rb") as fh:
                cmd = fh.read().replace(b"\0", b" ").decode("utf8", "replace").strip()
            if not cmd or not correspond(cmd, motif, exclure):
                continue
            demarrage = os.stat(f"/proc/{nom}").st_ctime
            with open(f"/proc/{nom}/status") as fh:
                etat = "stop" if re.search(r"State:\s*T", fh.read()) else "run"
            trouves.append((int(nom), demarrage, etat))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return trouves


def appliquer(actions):
    for verbe, pid in actions:
        try:
            if verbe == "renice":
                os.setpriority(os.PRIO_PROCESS, pid, 15)
            elif verbe == "stop":
                os.kill(pid, signal.SIGSTOP); print(f"suspend {pid}")
            elif verbe == "cont":
                os.kill(pid, signal.SIGCONT); print(f"reprend {pid}")
        except (ProcessLookupError, PermissionError):
            pass


def main():
    argv = sys.argv[1:]
    if not argv or "--help" in argv:
        print(__doc__)
        return 0
    if "--a-sec" in argv:
        return a_sec()
    ncpu = os.cpu_count() or 12
    params = dict(max_charge=ncpu * 0.6, ok_charge=ncpu * 0.4, min_mem_mo=2500, ok_mem_mo=4500, garder=2)
    motif, exclure, periode, une_fois = MOTIF_DEFAUT, EXCLURE_DEFAUT, 4.0, False
    cles_float = {"--max-charge": "max_charge", "--ok-charge": "ok_charge"}
    cles_int = {"--min-mem-mo": "min_mem_mo", "--ok-mem-mo": "ok_mem_mo", "--garder": "garder"}
    i = 0
    while i < len(argv):
        x = argv[i]
        if x in cles_float and i + 1 < len(argv):
            params[cles_float[x]] = float(argv[i + 1]); i += 1
        elif x in cles_int and i + 1 < len(argv):
            params[cles_int[x]] = int(argv[i + 1]); i += 1
        elif x == "--periode" and i + 1 < len(argv):
            periode = float(argv[i + 1]); i += 1
        elif x == "--motif" and i + 1 < len(argv):
            motif = argv[i + 1]; i += 1
        elif x == "--exclure" and i + 1 < len(argv):
            exclure = argv[i + 1]; i += 1
        elif x == "--une-fois":
            une_fois = True
        i += 1
    try:
        while True:
            appliquer(decider(loadavg(), mem_disponible_mo(), lister_rendus(motif, exclure), params))
            if une_fois:
                print("OK    tour  un tour de garde exécuté sans erreur")
                return 0
            time.sleep(periode)
    except KeyboardInterrupt:
        return 0
    except OSError as e:
        print(f"ÉCHEC tour  {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
