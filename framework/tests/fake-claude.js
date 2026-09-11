#!/usr/bin/env node
'use strict';
/**
 * fake-claude.js — seam de test (HOLARCH_FAKE_CLAUDE, docs/IMPLEMENTATION.md §3.7).
 * Remplace le binaire `claude` dans `runOnce` : mêmes arguments, même stdin, aucune session réelle.
 * Lit un scénario JSON (chemin dans HOLARCH_FAKE_SCENARIO) :
 *   { statusApres, note, reveil, ecrire: [{chemin, contenu, append}], commit: true, result: {...} }
 * - statusApres/note/reveil (optionnels) : met à jour mission/<HOLARCH_INSTANCE>/STATUS.md (État, Note,
 *   Réveil, Depuis) comme le ferait une vraie session à ON_SLEEP. Absents : STATUS.md n'est pas touché.
 * - ecrire : liste de fichiers à écrire, chemins relatifs à la racine (process.cwd(), le lanceur lance
 *   toujours claude avec cwd = root). append:true ajoute au contenu existant au lieu de l'écraser.
 * - commit : si vrai, `git add -A && git commit` (message fixe, horodaté).
 * - result : objet imprimé tel quel sur stdout (JSON), ce que `runOnce` attend de `claude --output-format
 *   stream-json` (parseResultJson).
 *
 * Extension chantier 5 (banc de mesure, docs/IMPLEMENTATION.md §6.1) :
 * - etapes: [pas1, pas2, …] — scénario à plusieurs sessions (ex. hibernation puis livraison, changement
 *   de régime). Chaque pas a la même forme que le scénario simple ci-dessus. Un compteur fichier
 *   « <HOLARCH_FAKE_SCENARIO>.attempt » retient le numéro d'appel (1, 2, …) à travers les invocations
 *   successives — chaque ré-incarnation relance ce script dans un nouveau process, rien ne survit en
 *   mémoire d'un appel à l'autre. Le pas appliqué est etapes[min(n-1, etapes.length-1)] : au-delà du
 *   dernier pas déclaré, celui-ci se répète plutôt que de planter.
 * - crash: {stderr, exitCode} — simule un plantage réel avant toute écriture de résultat : rien sur
 *   stdout, un message sur stderr, sortie avec le code demandé (exitCode:1 par défaut). Côté runOnce,
 *   parseResultJson(stdout vide) → res=null, comme un vrai crash du CLI.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function attemptCounterPath(scenarioPath) {
  return `${scenarioPath}.attempt`;
}

function nextAttempt(scenarioPath) {
  const p = attemptCounterPath(scenarioPath);
  let n = 0;
  try { n = Number(fs.readFileSync(p, 'utf8')) || 0; } catch (_) { /* premier appel : pas de compteur encore */ }
  n += 1;
  fs.writeFileSync(p, String(n));
  return n;
}

function readScenario() {
  const p = process.env.HOLARCH_FAKE_SCENARIO;
  if (!p) throw new Error('HOLARCH_FAKE_SCENARIO non défini');
  const brut = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(brut.etapes)) return brut;
  const n = nextAttempt(p);
  return brut.etapes[Math.min(n - 1, brut.etapes.length - 1)];
}

function updateStatus(root, instance, scenario) {
  if (!instance) return;
  if (scenario.statusApres === undefined && scenario.note === undefined && scenario.reveil === undefined) return;
  const p = path.join(root, 'mission', instance, 'STATUS.md');
  const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : `# Statut — ${instance}\n\n| Champ | Valeur |\n|---|---|\n| État | INIT |\n| Depuis | — |\n| Posé par | soi |\n| Note |  |\n| Réveil | — |\n`;
  const etat = scenario.statusApres !== undefined ? scenario.statusApres : (before.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m) || [, ''])[1];
  const note = scenario.note !== undefined ? scenario.note : (before.match(/^\|\s*Note\s*\|\s*(.*?)\s*\|\s*$/m) || [, ''])[1];
  const reveil = scenario.reveil !== undefined ? scenario.reveil : (before.match(/^\|\s*R[ée]veil\s*\|\s*(.*?)\s*\|\s*$/m) || [, '—'])[1];
  const depuis = new Date().toISOString();
  let after = before
    .replace(/^\|\s*[ÉE]tat\s*\|.*\|\s*$/m, `| État | ${etat} |`)
    .replace(/^\|\s*Depuis\s*\|.*\|\s*$/m, `| Depuis | ${depuis} |`)
    .replace(/^\|\s*Note\s*\|.*\|\s*$/m, `| Note | ${note} |`);
  if (/^\|\s*R[ée]veil\s*\|/m.test(after)) after = after.replace(/^\|\s*R[ée]veil\s*\|.*\|\s*$/m, `| Réveil | ${reveil} |`);
  else after += `| Réveil | ${reveil} |\n`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, after);
}

function applyEcritures(root, ecrire) {
  for (const e of ecrire || []) {
    const p = path.join(root, e.chemin);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (e.append && fs.existsSync(p)) fs.appendFileSync(p, e.contenu);
    else fs.writeFileSync(p, e.contenu);
  }
}

function main() {
  const root = process.cwd();
  const instance = process.env.HOLARCH_INSTANCE || '';
  const scenario = readScenario();
  if (scenario.crash) {
    process.stderr.write(scenario.crash.stderr || 'fake-claude: plantage simulé\n');
    process.exitCode = scenario.crash.exitCode === undefined ? 1 : scenario.crash.exitCode;
    return;
  }
  updateStatus(root, instance, scenario);
  applyEcritures(root, scenario.ecrire);
  if (scenario.commit) {
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['commit', '-m', `[${instance || 'fake-claude'}] scénario de test (fake-claude)`], { cwd: root });
  }
  process.stdout.write(JSON.stringify(scenario.result || {}));
}

main();
