"""Tests automatisés du prototype d'orchestrateur externe — mode simulé (rapide, sans coût
d'appel réel à `claude -p`). Vérifie la logique d'ordonnancement elle-même : respect des
dépendances, parallélisme réel obtenu, plafond `max_parallel` respecté, propagation d'échec.

Écrit sans `unittest` (absent de cet environnement Python minimal — ni `unittest` ni `pytest`
ni `json` ni `dataclasses` n'y sont installés) : un petit runner à base d'`assert` suffit et
évite d'introduire une dépendance externe pour un script de test unique.

Une démonstration bornée en conditions réelles (vrais sous-processus `claude -p`) est
documentée séparément dans docs/archive/mission-holon-v2/shared/concepteur/v2/orchestrator/RAPPORT.md — ces tests-ci
ne la remplacent pas, ils valident uniquement l'algorithme d'ordonnancement.
"""
import time

from external_orchestrator import Node, SchedulingError, SimulatedLauncher, run_mission

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


@test
def test_respects_dependencies():
    # A, B indépendants -> C dépend des deux -> D dépend de C.
    instances = {
        "A": Node("A", []),
        "B": Node("B", []),
        "C": Node("C", ["A", "B"]),
        "D": Node("D", ["C"]),
    }
    log = []
    finished, failed = run_mission(instances, SimulatedLauncher(default_duration=0.05), max_parallel=4, log=log)

    assert finished == {"A", "B", "C", "D"}, finished
    assert failed == set(), failed

    launch_time = {name: ts for event, name, ts in log if event == "launch"}
    done_time = {name: ts for event, name, ts in log if event == "done"}

    assert launch_time["C"] >= done_time["A"], "C lancé avant que A soit terminé"
    assert launch_time["C"] >= done_time["B"], "C lancé avant que B soit terminé"
    assert launch_time["D"] >= done_time["C"], "D lancé avant que C soit terminé"


@test
def test_independent_nodes_overlap_when_max_parallel_allows():
    instances = {"A": Node("A", []), "B": Node("B", [])}
    launcher = SimulatedLauncher(durations={"A": 0.2, "B": 0.2})
    t0 = time.monotonic()
    finished, failed = run_mission(instances, launcher, max_parallel=2)
    elapsed = time.monotonic() - t0

    assert finished == {"A", "B"}
    # Si A et B tournaient en parallèle, le temps total doit rester proche de 0.2s
    # (une seule durée), pas s'additionner à ~0.4s (deux durées en série).
    assert elapsed < 0.35, f"les deux nœuds indépendants ne semblent pas avoir tourné en parallèle ({elapsed:.3f}s)"


@test
def test_max_parallel_one_forces_sequential():
    instances = {"A": Node("A", []), "B": Node("B", [])}
    launcher = SimulatedLauncher(durations={"A": 0.2, "B": 0.2})
    t0 = time.monotonic()
    finished, failed = run_mission(instances, launcher, max_parallel=1)
    elapsed = time.monotonic() - t0

    assert finished == {"A", "B"}
    # Avec max_parallel=1 (comportement actuel de dependency-graph par défaut), les deux
    # durées doivent s'additionner : c'est la ligne de base que 2.1 cherche à dépasser.
    assert elapsed >= 0.38, f"max_parallel=1 aurait dû sérialiser A et B ({elapsed:.3f}s)"


@test
def test_never_exceeds_cap():
    instances = {name: Node(name, []) for name in ["A", "B", "C", "D", "E"]}
    launcher = SimulatedLauncher(default_duration=0.1)
    log = []
    run_mission(instances, launcher, max_parallel=2, log=log)

    concurrent = 0
    max_concurrent = 0
    for event, name, ts in sorted(log, key=lambda e: e[2]):
        if event == "launch":
            concurrent += 1
            max_concurrent = max(max_concurrent, concurrent)
        elif event in ("done", "failed"):
            concurrent -= 1

    assert max_concurrent <= 2, f"plafond dépassé : {max_concurrent} instances simultanées"
    assert max_concurrent >= 2, "le plafond devrait être atteint au moins une fois avec 5 nœuds indépendants et max_parallel=2"


@test
def test_dependents_of_a_failed_node_are_never_launched():
    instances = {
        "A": Node("A", []),
        "B": Node("B", ["A"]),  # dépend de A, qui va échouer
    }
    launcher = SimulatedLauncher(durations={"A": 0.05}, outcomes={"A": "BLOCKED"})
    log = []
    finished, failed = run_mission(instances, launcher, max_parallel=2, log=log)

    assert finished == set()
    assert failed == {"A", "B"}
    launched_names = {name for event, name, _ in log if event == "launch"}
    assert "B" not in launched_names, "B dépend d'un nœud BLOCKED : il ne doit jamais être lancé"
    skip_events = [name for event, name, _ in log if event == "skipped_dependency_failed"]
    assert "B" in skip_events


@test
def test_raises_on_unknown_dependency():
    instances = {"A": Node("A", ["ne-existe-pas"])}
    try:
        run_mission(instances, SimulatedLauncher(), max_parallel=1)
    except SchedulingError:
        return
    raise AssertionError("SchedulingError attendue pour une dépendance inconnue")


if __name__ == "__main__":
    failures = 0
    for fn in TESTS:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {fn.__name__} — {e}")
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} tests passés")
    raise SystemExit(1 if failures else 0)
