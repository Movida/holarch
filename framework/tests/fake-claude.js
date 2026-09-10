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
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readScenario() {
  const p = process.env.HOLARCH_FAKE_SCENARIO;
  if (!p) throw new Error('HOLARCH_FAKE_SCENARIO non défini');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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
  updateStatus(root, instance, scenario);
  applyEcritures(root, scenario.ecrire);
  if (scenario.commit) {
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['commit', '-m', `[${instance || 'fake-claude'}] scénario de test (fake-claude)`], { cwd: root });
  }
  process.stdout.write(JSON.stringify(scenario.result || {}));
}

main();
