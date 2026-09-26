'use strict';

// Chantier 17, §17.5 : `holarch-init` propose le preset `artefacts` quand « références » ou « faits à valider » est non vide.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OUTIL = path.join(__dirname, 'holarch-init.js');
const init = require(OUTIL);

const SOLO = {
  mission: 'clip-anniversaire', objectif: 'Monter un clip de trois minutes à partir de photos.',
  reussite: 'Le clip est validé par le commanditaire.', ampleur: 'solo', dependances: false, audit: false, suivi: true,
};

test('références non vides (solo) : preset artefacts, quatre extensions et paramètres du preset', () => {
  const d = init.deriver({ ...SOLO, references: 'Veut : sobre. Ne veut pas : de musique criarde.' });
  assert.strictEqual(d.preset, 'artefacts');
  const noms = d.modules.map((m) => m.nom);
  for (const n of ['git-branches', 'milestone-reviews', 'regles-du-metier', 'jobs-et-lots']) assert.ok(noms.includes(n), `${n} absent`);
  assert.ok(noms.indexOf('regles-du-metier') < noms.indexOf('heartbeat-log'), 'extensions avant observabilite');
  assert.strictEqual(d.parametres.mode_attente, 'detache');
  assert.strictEqual(d.parametres.isolation, 'worktree');
  assert.strictEqual(d.parametres.budget_usd_par_session, 8);
  assert.strictEqual(d.parametres.sessions_sans_unite_max, 3);
});

test('faits à valider seuls suffisent ; blancs seuls ne suffisent pas', () => {
  assert.strictEqual(init.deriver({ ...SOLO, faits_a_valider: 'Le prénom exact des mariés.' }).preset, 'artefacts');
  const d = init.deriver({ ...SOLO, references: '   ', faits_a_valider: '' });
  assert.strictEqual(d.preset, 'solo-light');
  assert.ok(!d.modules.some((m) => m.nom === 'regles-du-metier'));
});

test('équipe : team-standard reste prioritaire même avec un artefact déclaré', () => {
  const d = init.deriver({ ...SOLO, ampleur: 'equipe', references: 'Veut : sobre.' });
  assert.strictEqual(d.preset, 'team-standard');
  assert.ok(!d.modules.some((m) => m.nom === 'regles-du-metier'));
});

test('CONFIG.md produit sous artefacts : preset annoncé, valeurs organisationnelles de solo-light', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-init-artefacts-'));
  const f = path.join(dir, 'reponses.json');
  fs.writeFileSync(f, JSON.stringify({ ...SOLO, references: 'Veut : sobre.' }));
  execFileSync('node', [OUTIL, '--reponses', f, '--out', dir], { encoding: 'utf8' });
  const config = fs.readFileSync(path.join(dir, 'CONFIG.md'), 'utf8');
  assert.ok(config.includes('> Preset de base : artefacts'));
  assert.ok(config.includes('| extensions | regles-du-metier |'));
  assert.ok(config.includes('| isolation | worktree |'));
  assert.ok(config.includes('En cas de doute entre faire seul et spawner, faire seul.'));
});
