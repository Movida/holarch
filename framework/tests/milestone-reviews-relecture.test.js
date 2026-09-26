'use strict';
// Test de `milestone-reviews` 1.1.0 — relecture par une instance distincte (chantier 17, docs/IMPLEMENTATION.md §17.4,
// mission holarch-specialisation) : forme du module (module-forge), composition du preset `artefacts` (config-lint),
// règles présentes dans le prompt système construit par le lanceur (équivalent du dry-run), anomalie
// `jalon-sans-relecture` de holarch-observe sur une mission fabriquée. Fonctionne dans le paquet promouvable
// (fragments appliqués ici en mémoire) comme après promotion (framework/tests/, fichiers du dépôt).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CIBLE = path.resolve(__dirname, '..');
function trouverDepot(depart) {
  for (let d = depart; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'framework', 'bin', 'holarch-spawn.js'))
      && fs.existsSync(path.join(d, 'tools', 'holarch-observe', 'collecte.js'))) return d;
    if (path.dirname(d) === d) throw new Error(`dépôt introuvable en remontant depuis ${depart}`);
  }
}
const DEPOT = trouverDepot(path.resolve(__dirname, '..', '..'));
const PAQUET = path.resolve(CIBLE, '..', '..');
const pick = (rel) => (fs.existsSync(path.join(CIBLE, rel)) ? path.join(CIBLE, rel) : path.join(DEPOT, 'framework', rel));
const LANCEUR = require(pick('bin/holarch-spawn.js'));
const MODULE = pick('modules/extensions/milestone-reviews.md');
const MODULE_TEXTE = fs.readFileSync(MODULE, 'utf8');

/** MANIFEST.md après promotion : ligne regles-du-metier insérée et cellule de version de milestone-reviews remplacée. */
function manifestTexte() {
  let t = fs.readFileSync(pick('MANIFEST.md'), 'utf8');
  const frag = (nom) => { const p = path.join(CIBLE, nom); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
  const regles = frag('MANIFEST.regles-du-metier.fragment.md');
  if (regles && !t.includes('| [regles-du-metier]')) {
    const fin = t.indexOf('\n', t.indexOf('| [delegation-intra-session]')) + 1;
    t = t.slice(0, fin) + regles + t.slice(fin);
  }
  const version = frag('MANIFEST.milestone-reviews-version.fragment.md');
  if (version) t = t.replace('| [milestone-reviews](modules/extensions/milestone-reviews.md) | extensions | 1.0.0 |', version.trimEnd());
  return t;
}

const PRESET = fs.readFileSync(pick('presets/artefacts.md'), 'utf8').match(/```markdown\n([\s\S]*?)\n```/)[1];
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-relecture-'));
const FW = path.join(ROOT, 'framework');
fs.mkdirSync(FW, { recursive: true });
fs.copyFileSync(pick('KERNEL.md'), path.join(FW, 'KERNEL.md'));
fs.cpSync(path.join(DEPOT, 'framework', 'modules'), path.join(FW, 'modules'), { recursive: true });
for (const rel of ['modules/extensions/milestone-reviews.md', 'modules/extensions/regles-du-metier.md']) fs.copyFileSync(pick(rel), path.join(FW, rel));
fs.writeFileSync(path.join(FW, 'MANIFEST.md'), manifestTexte());
fs.writeFileSync(path.join(FW, 'CONFIG.md'), `${PRESET}\n`);
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('module-forge : milestone-reviews 1.1.0 conforme, version alignée au MANIFEST', () => {
  assert.match(MODULE_TEXTE, /^> Version : 1\.1\.0$/m);
  const r = spawnSync(process.execPath, [path.join(DEPOT, 'tools', 'module-forge', 'validate-module.js'), 'module',
    path.join(FW, 'modules', 'extensions', 'milestone-reviews.md'), '--manifest', path.join(FW, 'MANIFEST.md'),
    '--modules-dir', path.join(FW, 'modules')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('config-lint : preset artefacts valide avec milestone-reviews 1.1.0', () => {
  const r = spawnSync(process.execPath, [path.join(DEPOT, 'tools', 'config-lint', 'config-lint.js'), path.join(FW, 'CONFIG.md'),
    '--manifest', path.join(FW, 'MANIFEST.md'), '--modules-dir', path.join(FW, 'modules')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('règles injectées : relecture sœur à ON_SPAWN, acceptation liée à la relecture à ON_CHILD_DONE', () => {
  const section = (hook) => MODULE_TEXTE.split(`### ⚓ ${hook}`)[1].split(/\n### |\n## /)[0];
  assert.match(section('ON_SPAWN'), /`<nom>-relecture`[\s\S]*profil `relecture`[\s\S]*sur pièces[\s\S]*enfant direct `relecture`/);
  assert.match(section('ON_CHILD_DONE'), /n'est accepté qu'avec le `DELIVERABLE` de sa relecture[\s\S]*jalon-sans-relecture/);
  const prompt = LANCEUR.buildSystemPrompt(ROOT, LANCEUR.parseConfig(PRESET), false);
  assert.match(prompt, /Relecture distincte/);
  assert.match(prompt, /jalon-sans-relecture/);
});

// --- holarch-observe : collecte.js du dépôt, ou copie en mémoire avec le fragment du paquet ------------------------
function chargerCollecte() {
  const src = path.join(DEPOT, 'tools', 'holarch-observe', 'collecte.js');
  const texte = fs.readFileSync(src, 'utf8');
  if (texte.includes('jalon-sans-relecture')) return require(src);
  const frag = fs.readFileSync(path.join(PAQUET, 'cible-tools', 'tools', 'holarch-observe', 'collecte.relecture.fragment.js'), 'utf8');
  const ancre = '  // Évaluation des réveils dans un second temps (les états des frères sont connus)';
  assert.equal(texte.split(ancre).length, 2, 'ancre du fragment unique dans collecte.js');
  const patche = texte.replace(ancre, frag + ancre)
    .replace("require('../../framework/bin/reveil.js')", `require(${JSON.stringify(path.join(DEPOT, 'framework', 'bin', 'reveil.js'))})`)
    .replace("require('../message-lint/message-lint.js')", `require(${JSON.stringify(path.join(DEPOT, 'tools', 'message-lint', 'message-lint.js'))})`);
  const dest = path.join(ROOT, 'collecte-patche.js');
  fs.writeFileSync(dest, patche);
  return require(dest);
}
const collecte = chargerCollecte();

const ENV_GIT = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' });
const ecrire = (root, rel, c) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const STATUS = (etat) => `# Statut\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-11T10:00:00Z |\n| Posé par | soi |\n| Note | — |\n| Réveil | — |\n`;
const MSG = (id, from, to, type, ref, date) => `\n---\nid: ${id}\nfrom: ${from}\nto: ${to}\ntype: ${type}\nref: ${ref}\ndate: ${date}\n---\ncorps\n`;
const ROLE_ARTEFACT = '# Rôle : producteur\n\n## Validations requises\n| Porte | Quoi | Par qui | Protège |\n|---|---|---|---|\n| V1 | échantillon | parent | film |\n';

/** Mission : racine `concepteur`, producteur `concepteur/prod` (artefact, DELIVERED, un DELIVERABLE à 12:00). */
function mission(avecModule) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-relecture-obs-'));
  ecrire(root, 'framework/KERNEL.md', '# KERNEL\n');
  ecrire(root, 'framework/CONFIG.md', `# Configuration — mission : relecture\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n| 1 | orchestration | direct-spawn |\n${avecModule ? '| 2 | extensions | milestone-reviews |\n' : ''}\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| budget_instances_total | 5 |\n`);
  ecrire(root, 'mission/OBJECTIVE.md', '# Objectif — mission `relecture`\n');
  ecrire(root, 'mission/.holarch/.gitignore', '*\n');
  for (const f of ['INBOX', 'OUTBOX']) ecrire(root, `mission/concepteur/${f}.md`, `# ${f}\n`);
  ecrire(root, 'mission/concepteur/STATUS.md', STATUS('WAITING_CHILDREN'));
  ecrire(root, 'mission/concepteur/prod/STATUS.md', STATUS('DELIVERED'));
  ecrire(root, 'mission/concepteur/prod/ROLE.md', ROLE_ARTEFACT);
  ecrire(root, 'mission/concepteur/prod/INBOX.md', '# INBOX\n');
  ecrire(root, 'mission/concepteur/prod/OUTBOX.md', `# OUTBOX\n${MSG('MSG-p-1', 'concepteur/prod', 'concepteur', 'DELIVERABLE', '—', '2026-09-11T12:00:00Z')}`);
  spawnSync('git', ['init', '-q', '-b', 'main', root], { env: ENV_GIT });
  spawnSync('git', ['-C', root, 'add', '-A'], { env: ENV_GIT });
  spawnSync('git', ['-C', root, 'commit', '-q', '-m', '[bootstrap] mission'], { env: ENV_GIT });
  return root;
}
const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-relecture-tr-'));
test.after(() => fs.rmSync(tdir, { recursive: true, force: true }));
const anomalies = (root) => collecte.collecter(root, { ps: () => '', transcriptionsDir: () => tdir, pidVivant: () => false })
  .anomalies.filter((a) => a.code === 'jalon-sans-relecture');

test('observe : producteur d\'artefact DELIVERED sans relecture → jalon-sans-relecture (info) ; relecture postérieure → rien', () => {
  const root = mission(true);
  try {
    let a = anomalies(root);
    assert.equal(a.length, 1, JSON.stringify(a));
    assert.equal(a[0].niveau, 'info'); assert.equal(a[0].chemin, 'concepteur/prod');
    ecrire(root, 'mission/concepteur/prod-relecture/STATUS.md', STATUS('DELIVERED'));
    ecrire(root, 'mission/concepteur/prod-relecture/OUTBOX.md', `# OUTBOX\n${MSG('MSG-r-1', 'concepteur/prod-relecture', 'concepteur', 'DELIVERABLE', '—', '2026-09-11T11:00:00Z')}`);
    assert.equal(anomalies(root).length, 1, 'une relecture antérieure au jalon ne le couvre pas');
    ecrire(root, 'mission/concepteur/prod-relecture/OUTBOX.md', `# OUTBOX\n${MSG('MSG-r-1', 'concepteur/prod-relecture', 'concepteur', 'DELIVERABLE', '—', '2026-09-11T12:30:00Z')}`);
    assert.deepEqual(anomalies(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('observe : jalon intermédiaire accepté par RESPONSE sans relecture → anomalie ; non accepté → rien', () => {
  const root = mission(true);
  try {
    ecrire(root, 'mission/concepteur/prod/STATUS.md', STATUS('WORKING'));
    assert.deepEqual(anomalies(root), []);
    ecrire(root, 'mission/concepteur/prod/INBOX.md', `# INBOX\n${MSG('MSG-c-1', 'concepteur', 'concepteur/prod', 'RESPONSE', 'MSG-p-1', '2026-09-11T13:00:00Z')}`);
    assert.equal(anomalies(root).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('observe : racine productrice, relecture en enfant direct `relecture` ; module inactif → aucune anomalie', () => {
  const root = mission(true);
  try {
    fs.rmSync(path.join(root, 'mission', 'concepteur', 'prod'), { recursive: true });
    ecrire(root, 'mission/concepteur/ROLE.md', ROLE_ARTEFACT);
    ecrire(root, 'mission/concepteur/OUTBOX.md', `# OUTBOX\n${MSG('MSG-c-1', 'concepteur', 'utilisateur', 'DELIVERABLE', 'J1', '2026-09-11T12:00:00Z')}`);
    ecrire(root, 'mission/concepteur/INBOX.md', `# INBOX\n${MSG('MSG-u-1', 'utilisateur', 'concepteur', 'RESPONSE', 'MSG-c-1', '2026-09-11T14:00:00Z')}`);
    assert.equal(anomalies(root).length, 1);
    ecrire(root, 'mission/concepteur/relecture/STATUS.md', STATUS('DELIVERED'));
    ecrire(root, 'mission/concepteur/relecture/OUTBOX.md', `# OUTBOX\n${MSG('MSG-r-1', 'concepteur/relecture', 'concepteur', 'DELIVERABLE', 'MSG-c-1', '2026-09-11T13:00:00Z')}`);
    assert.deepEqual(anomalies(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const sans = mission(false);
  try { assert.deepEqual(anomalies(sans), []); } finally { fs.rmSync(sans, { recursive: true, force: true }); }
});
