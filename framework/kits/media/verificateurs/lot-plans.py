#!/usr/bin/env python3
"""Devis avant un lot de plans payant, et reprise par empreinte (aucun appel réseau ici).

Garantit : un lot n'est jamais rejoué à tort — un plan n'est « fait » que si son empreinte
courante (image + prompt + négatif + durée + service + modèle) est celle enregistrée pour lui
ET que sa sortie existe ; jamais « fichier présent = fait », jamais par date de modification.
Vérifier : python3 verificateurs/lot-plans.py --a-sec

Usage :
  python3 verificateurs/lot-plans.py <plans.json> <sortie_dir> [--modele M] [--budget X]
      [--tarif service=prix ...] [--marquer id]
Entrée : JSON liste de plans {id, prompt, image?, negatif?, duree?, service}.
"""
import hashlib, os, re, sys

LIMITES = {"kling": 2500}
# JSON minimal par expressions régulières, restreint aux champs scalaires (pas de module json ici).
_PAIRE = re.compile(r'"([^"\\]*)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+\.?\d*(?:[eE][+-]?\d+)?|true|false|null)')

def _valeur(tok):
    if tok.startswith('"'):
        return tok[1:-1].replace('\\"', '"').replace('\\n', '\n').replace('\\\\', '\\')
    if tok == "null": return None
    if tok in ("true", "false"): return tok == "true"
    return float(tok) if any(c in tok for c in ".eE") else int(tok)

def _objet(fragment): return {k: _valeur(v) for k, v in _PAIRE.findall(fragment)}
def lire_plans(texte): return [_objet(o) for o in re.findall(r"\{[^{}]*\}", texte)]
def lire_dict(texte): return _objet(texte)

def ecrire_dict(d):
    esc = lambda x: str(x).replace('\\', '\\\\').replace('"', '\\"')
    return "{" + ",".join(f'"{esc(k)}":"{esc(v)}"' for k, v in d.items()) + "}"

# ── fonctions pures de décision ──────────────────────────────────────────────
def verifier_longueur(prompt, service, limites=LIMITES):
    if service not in limites: return "inconnu"
    return "ok" if len(prompt) <= limites[service] else "depasse"

def verifier_negatif(negatif): return bool(negatif)

def calculer_empreinte(contenu_image, prompt, negatif, duree, service, modele):
    h = hashlib.sha256(); h.update(contenu_image or b"")
    for m in (prompt or "", negatif or "", str(duree or ""), service or "", modele or ""):
        h.update(b"\x00" + m.encode("utf8"))
    return h.hexdigest()

def est_fait(empreinte_actuelle, empreinte_enregistree, sortie_existe):  # jamais fichier présent = fait
    return sortie_existe and empreinte_enregistree is not None and empreinte_actuelle == empreinte_enregistree

def devis(services_a_faire, tarifs): return sum(tarifs.get(s, 0) for s in services_a_faire)

def a_sec():
    n = 0
    assert verifier_longueur("bref", "kling") == "ok"; n += 1
    assert verifier_longueur("x" * 3000, "kling") == "depasse"; n += 1
    assert verifier_longueur("bref", "service-mystere") == "inconnu"; n += 1
    assert verifier_negatif("flou, texte") is True and verifier_negatif("") is False; n += 1
    e1 = calculer_empreinte(b"photo", "un prompt", "flou", "5", "kling", "v1")
    e3 = calculer_empreinte(b"photo", "un autre prompt", "flou", "5", "kling", "v1")
    assert e1 == calculer_empreinte(b"photo", "un prompt", "flou", "5", "kling", "v1") and e1 != e3; n += 1
    assert est_fait(e1, e1, True) is True and est_fait(e1, e3, True) is False; n += 1
    assert est_fait(e1, e1, False) is False; n += 1
    assert devis(["kling", "kling", "service-mystere"], {"kling": 4}) == 8; n += 1
    d = lire_plans('[{"id":"u1-p01","prompt":"un plan, avec virgule","duree":5,"service":"kling"}]')
    assert d[0]["id"] == "u1-p01" and d[0]["prompt"] == "un plan, avec virgule" and d[0]["duree"] == 5; n += 1
    assert lire_dict(ecrire_dict({"u1": 'abcd"ef'})) == {"u1": 'abcd"ef'}; n += 1
    print(f"a-sec : {n} cas OK")
    return 0

# ── mode réel ────────────────────────────────────────────────────────────────
def charger_empreintes(sortie_dir):
    p = os.path.join(sortie_dir, ".empreintes.json")
    if not os.path.exists(p): return {}
    with open(p, encoding="utf8") as fh: return lire_dict(fh.read())

def enregistrer_empreinte(sortie_dir, plan_id, empreinte):
    empreintes = charger_empreintes(sortie_dir); empreintes[plan_id] = empreinte
    tmp = os.path.join(sortie_dir, ".empreintes.json.tmp")
    with open(tmp, "w", encoding="utf8") as fh: fh.write(ecrire_dict(empreintes))
    os.replace(tmp, os.path.join(sortie_dir, ".empreintes.json"))

def contenu_image(plan, avertissements):
    if not plan.get("image"): return None
    if not os.path.exists(plan["image"]):
        avertissements.append(f"{plan['id']} : image absente {plan['image']}")
        return None
    with open(plan["image"], "rb") as fh: return fh.read()

def analyser_argv(argv):
    pos, opts, tarifs, i = [], {}, {}, 0
    while i < len(argv):
        x = argv[i]
        if x in ("--modele", "--budget", "--marquer") and i + 1 < len(argv):
            opts[x[2:]] = argv[i + 1]; i += 1
        elif x == "--tarif" and i + 1 < len(argv):
            s, prix = argv[i + 1].split("=", 1); tarifs[s] = float(prix); i += 1
        elif not x.startswith("--"):
            pos.append(x)
        i += 1
    return pos, opts, tarifs

def marquer(plans, sortie_dir, plan_id, modele):
    plan = next((p for p in plans if p["id"] == plan_id), None)
    if plan is None: print(f"plan introuvable : {plan_id}", file=sys.stderr); return 2
    av = []
    emp = calculer_empreinte(contenu_image(plan, av), plan.get("prompt"), plan.get("negatif"),
                              plan.get("duree"), plan.get("service"), modele)
    enregistrer_empreinte(sortie_dir, plan_id, emp)
    print(f"OK    marque {plan_id} empreinte enregistrée")
    return 0

def evaluer_lot(plans, sortie_dir, empreintes, modele, tarifs, budget):
    a_faire, faits, av = [], [], []
    for plan in plans:
        pid, service = plan["id"], plan.get("service")
        statut = verifier_longueur(plan.get("prompt", ""), service)
        if statut != "ok": av.append(f"{pid} : longueur de prompt {statut} pour service {service}")
        if not verifier_negatif(plan.get("negatif")): av.append(f"{pid} : pas de négatif")
        emp = calculer_empreinte(contenu_image(plan, av), plan.get("prompt"), plan.get("negatif"),
                                  plan.get("duree"), service, modele)
        sortie = os.path.join(sortie_dir, f"{pid}.mp4")
        (faits if est_fait(emp, empreintes.get(pid), os.path.exists(sortie)) else a_faire).append(plan)
    print(f"à faire : {len(a_faire)}  ·  faits : {len(faits)}")
    for ligne in av: print(f"avertissement : {ligne}")
    total = devis([p.get("service") for p in a_faire], tarifs)
    print(f"devis : {total:.2f}")
    if budget is not None and total > float(budget):
        print(f"ÉCHEC devis {total:.2f} > budget {float(budget):.2f}", file=sys.stderr); return 1
    return 0

def main():
    argv = sys.argv[1:]
    if not argv or "--help" in argv: print(__doc__); return 0
    if "--a-sec" in argv: return a_sec()
    pos, opts, tarifs = analyser_argv(argv)
    if len(pos) < 2:
        print("usage : lot-plans.py <plans.json> <sortie_dir> [...]", file=sys.stderr); return 2
    plans_json, sortie_dir = pos[0], pos[1]
    if not os.path.exists(plans_json): print(f"fichier introuvable : {plans_json}", file=sys.stderr); return 2
    os.makedirs(sortie_dir, exist_ok=True)
    with open(plans_json, encoding="utf8") as fh: plans = lire_plans(fh.read())
    modele = opts.get("modele", "defaut")
    if "marquer" in opts:
        return marquer(plans, sortie_dir, opts["marquer"], modele)
    return evaluer_lot(plans, sortie_dir, charger_empreintes(sortie_dir), modele, tarifs, opts.get("budget"))

if __name__ == "__main__":
    sys.exit(main())
