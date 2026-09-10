"""Prototype d'orchestrateur externe pour HOLARCH (priorités 2.1 + 3.2 de SYNTHESE-HOLON-V2.md).

Ce script vit hors de framework/ (aucune instance ne peut le lire ni l'exécuter comme un
module HOLARCH — cloisonnement KERNEL §4, voir docs/archive/mission-holon-v2/concepteur/JOURNAL.md session n°2). Il
ordonnance en parallèle réel un ensemble d'instances d'une mission, en respectant leur graphe
de dépendances et un plafond `max_parallel` — la capacité qui manque aujourd'hui à
`dependency-graph` (dont `max_parallel` vaut 1 par défaut et n'est interprété par aucun
mécanisme d'exécution simultanée réel).

Le graphe de dépendances est lu directement depuis les fiches `registry/instances/*.md` d'une
mission (colonne "Dépend de", noms séparés par des virgules ou "—") : aucun format de fichier
supplémentaire n'est introduit, conformément à l'esprit "un ensemble de fichiers markdown
normatifs" du projet.

Deux launchers sont fournis :
- `SimulatedLauncher` : ne lance aucun sous-processus réel, simule une durée de travail fixe
  et un statut final configurable. Utilisé par les tests automatisés (rapidité, coût nul).
- `RealLauncher` : lance un vrai sous-processus `claude -p "Tu incarnes l'instance <chemin>..."`
  (gabarit `commande_cli` de `direct-spawn`) et suit `STATUS.md` de l'instance pour détecter la
  fin (`DELIVERED` / `BLOCKED` / `FAILED`).
"""
from __future__ import annotations

import os
import re
import subprocess
import time

TERMINAL_OK = {"DELIVERED"}
TERMINAL_FAILED = {"BLOCKED", "FAILED"}
TERMINAL = TERMINAL_OK | TERMINAL_FAILED


class Node:
    def __init__(self, name: str, deps: list[str] | None = None):
        self.name = name
        self.deps = deps or []


def load_instances(mission_root: str) -> dict[str, Node]:
    """Lit registry/instances/*.md et en extrait le graphe de dépendances (colonne "Dépend de")."""
    instances_dir = os.path.join(mission_root, "registry", "instances")
    nodes: dict[str, Node] = {}
    for fname in sorted(os.listdir(instances_dir)):
        if not fname.endswith(".md"):
            continue
        path = os.path.join(instances_dir, fname)
        with open(path, encoding="utf-8") as f:
            content = f.read()
        name = fname[:-3]
        m = re.search(r"\|\s*D[ée]pend de\s*\|\s*(.*?)\s*\|", content)
        deps_raw = m.group(1).strip() if m else "—"
        deps = [] if deps_raw in ("—", "-", "") else [d.strip().strip("`") for d in deps_raw.split(",")]
        nodes[name] = Node(name=name, deps=deps)
    return nodes


class SimulatedLauncher:
    """Launcher sans sous-processus réel — pour les tests automatisés."""

    def __init__(self, durations: dict[str, float] | None = None, outcomes: dict[str, str] | None = None,
                 default_duration: float = 0.3):
        self.durations = durations or {}
        self.outcomes = outcomes or {}
        self.default_duration = default_duration
        self.starts: dict[str, float] = {}
        self.ends: dict[str, float] = {}

    def launch(self, name: str):
        self.starts[name] = time.monotonic()
        return name  # le "handle" est trivial en mode simulé

    def poll_status(self, name: str, handle) -> str:
        elapsed = time.monotonic() - self.starts[name]
        duration = self.durations.get(name, self.default_duration)
        if elapsed < duration:
            return "WORKING"
        if name not in self.ends:
            self.ends[name] = time.monotonic()
        return self.outcomes.get(name, "DELIVERED")


class RealLauncher:
    """Launcher réel : sous-processus `claude -p` par instance, cwd = racine de la mission.

    `extra_instructions`, si fourni, est ajouté après le gabarit `commande_cli` figé de
    `direct-spawn` (le préfixe "Tu incarnes l'instance <nom>." reste intact, seul le
    complément change) — utile pour contourner une lacune d'environnement confirmée : une
    commande Bash non pré-autorisée (même `git status` sans `-C`) bloque indéfiniment une
    session `-p` non interactive, faute de TTY pour l'approuver (voir
    shared/concepteur/v2/orchestrator/RAPPORT.md, et la proposition d'amélioration déjà notée
    dans shared/concepteur/RAPPORT.md §"Propositions d'amélioration" point 1).
    """

    def __init__(self, sandbox_root: str, permission_mode: str = "acceptEdits", extra_instructions: str = ""):
        # `sandbox_root` contient framework/ et mission/ côte à côte (cwd attendu par les
        # chemins relatifs "framework/..." écrits dans ROLE.md/CONFIG.md) — distinct du
        # `mission_root` (= sandbox_root/mission) utilisé par `load_instances` pour le registre.
        self.sandbox_root = sandbox_root
        self.permission_mode = permission_mode
        self.extra_instructions = extra_instructions
        self.starts: dict[str, float] = {}
        self.ends: dict[str, float] = {}

    def _status_path(self, name: str) -> str:
        return os.path.join(self.sandbox_root, "mission", name, "STATUS.md")

    def _read_status(self, name: str) -> str:
        path = self._status_path(name)
        if not os.path.exists(path):
            return "INIT"
        with open(path, encoding="utf-8") as f:
            content = f.read()
        m = re.search(r"\|\s*[ÉE]tat\s*\|\s*(\w+)\s*\|", content)
        return m.group(1) if m else "INIT"

    def launch(self, name: str):
        prompt = f"Tu incarnes l'instance {name}. Commence par lire framework/KERNEL.md et suis le cycle de vie.{self.extra_instructions}"
        cmd = ["claude", "-p", prompt, "--permission-mode", self.permission_mode]
        self.starts[name] = time.monotonic()
        proc = subprocess.Popen(cmd, cwd=self.sandbox_root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return proc

    def poll_status(self, name: str, handle) -> str:
        status = self._read_status(name)
        if status in TERMINAL:
            if name not in self.ends:
                self.ends[name] = time.monotonic()
            return status
        if handle.poll() is not None:
            # Processus terminé sans atteindre un état terminal : traité comme une session
            # plantée par direct-spawn (spec §12) — ici, faute de logique de relance dans ce
            # prototype, remonté directement en FAILED plutôt que silencieusement ignoré.
            if name not in self.ends:
                self.ends[name] = time.monotonic()
            return "FAILED"
        return "WORKING"


class SchedulingError(RuntimeError):
    pass


def run_mission(instances: dict[str, Node], launcher, max_parallel: int, poll_interval: float = 0.05,
                 log: list | None = None) -> tuple[set[str], set[str]]:
    """Ordonnance `instances` avec `launcher`, en lançant au plus `max_parallel` instances à la fois,
    sans jamais lancer une instance avant que toutes ses dépendances soient `DELIVERED`.

    Retourne (finished, failed_or_skipped). `log` (si fourni) reçoit des tuples
    (event, name, timestamp) pour inspection par les tests.
    """
    if log is None:
        log = []
    unknown_deps = {d for node in instances.values() for d in node.deps if d not in instances}
    if unknown_deps:
        raise SchedulingError(f"dépendances inconnues : {sorted(unknown_deps)}")

    running: dict[str, object] = {}
    finished: set[str] = set()
    failed: set[str] = set()

    def ready(name: str) -> bool:
        if name in finished or name in running or name in failed:
            return False
        deps = instances[name].deps
        if any(d in failed for d in deps):
            return False
        return all(d in finished for d in deps)

    while len(finished) + len(failed) < len(instances):
        for name in instances:
            if len(running) >= max_parallel:
                break
            if ready(name):
                handle = launcher.launch(name)
                running[name] = handle
                log.append(("launch", name, time.monotonic()))

        progressed = False
        for name in list(running):
            status = launcher.poll_status(name, running[name])
            if status in TERMINAL_OK:
                finished.add(name)
                del running[name]
                log.append(("done", name, time.monotonic()))
                progressed = True
            elif status in TERMINAL_FAILED:
                failed.add(name)
                del running[name]
                log.append(("failed", name, time.monotonic()))
                progressed = True

        remaining = set(instances) - finished - failed - set(running)
        if not running and not any(ready(n) for n in remaining):
            for name in remaining:
                failed.add(name)
                log.append(("skipped_dependency_failed", name, time.monotonic()))
            progressed = True

        if not progressed:
            time.sleep(poll_interval)

    return finished, failed


def format_report(log: list) -> str:
    lines = [f"{ts:.3f}  {event:<25} {name}" for event, name, ts in log]
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: external_orchestrator.py <sandbox_root> <max_parallel>")
        sys.exit(1)
    sandbox_root, max_parallel = sys.argv[1], int(sys.argv[2])
    instances = load_instances(os.path.join(sandbox_root, "mission"))
    # Contournement documenté (voir docstring RealLauncher) : sans TTY pour approuver une
    # commande Bash non pré-autorisée, une session -p non interactive reste bloquée
    # indéfiniment — confirmé empiriquement lors de la démonstration bornée de ce prototype.
    no_bash = (
        " Contrainte de cet environnement bac-à-sable : n'utilise aucun outil Bash "
        "(pas de git, pas de commande shell) — lis avec Read, écris tes livrables avec "
        "Write/Edit uniquement, et saute toute étape du cycle de vie qui nécessiterait "
        "un commit Git ou une autre commande Bash."
    )
    launcher = RealLauncher(sandbox_root, extra_instructions=no_bash)
    log: list = []
    t0 = time.monotonic()
    finished, failed = run_mission(instances, launcher, max_parallel, log=log)
    print(format_report(log))
    print(f"\nTerminé en {time.monotonic() - t0:.1f}s — livrés : {sorted(finished)} — échoués/écartés : {sorted(failed)}")
