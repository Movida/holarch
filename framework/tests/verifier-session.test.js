'use strict';
// Tests du garde a posteriori fondé sur le dépôt (IMPLEMENTATION §11.4, chantier 9 volet 4).
// Chaque test construit un dépôt jetable sous os.tmpdir() : aucune dépendance au dépôt courant.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { verifierSession } = require('../bin/gardes/git.js');

// ---------------------------------------------------------------- fixtures Git jetables

function git(dir, args, env) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env),
  });
}

function creerDepot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-'));
  git(dir, ['init', '-q']);
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return dir;
}

function ecrire(dir, fichiers) {
  for (const [rel, contenu] of Object.entries(fichiers)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contenu);
  }
}

function commit(dir, message, { date } = {}) {
  git(dir, ['add', '-A']);
  const env = {
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t',
  };
  if (date) { env.GIT_AUTHOR_DATE = date; env.GIT_COMMITTER_DATE = date; }
  git(dir, ['commit', '-q', '-m', message], env);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

function nettoyer(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Écarts d'une seule règle, pour isoler chaque cas des autres règles. */
function ecartsRegle(resultat, n) {
  return resultat.ecarts.filter((e) => e.regle === n);
}

// ---------------------------------------------------------------- fixtures « instance normale »

const CHEMIN = 'concepteur/enfant';

function status(etat, note = '', reveilTxt = '—') {
  return `# Statut\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Note | ${note} |\n| Réveil | ${reveilTxt} |\n`;
}

function fiche(alloue, consomme = 0) {
  return `# Fiche\n| Champ | Valeur |\n|---|---|\n| Budget alloué / consommé | ${alloue} / ${consomme} |\n`;
}

/** Arbre normal d'une instance `concepteur/enfant`, sans rien de litigieux. */
function arbreNormal({ etat = 'WORKING', note = 'hibernation volontaire (init)', reveilTxt = '—', journal = '## init\nRien à signaler.\n', alloue = 1 } = {}) {
  return {
    'mission/concepteur/enfant/ROLE.md': '# Rôle\n',
    'mission/concepteur/enfant/MEMORY.md': '# Mémoire\n',
    'mission/concepteur/enfant/STATUS.md': status(etat, note, reveilTxt),
    'mission/concepteur/enfant/JOURNAL.md': journal,
    'mission/concepteur/enfant/INBOX.md': '# Boîte entrante\n',
    'mission/concepteur/enfant/OUTBOX.md': '# Boîte sortante\n',
    'mission/registry/instances/concepteur-enfant.md': fiche(alloue),
  };
}

// ================================================================== Règle 1 : arbre autorisé

test('règle 1 : écritures hors arbre — 4 chemins interdits comptés un par un', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal());
    const avant = commit(dir, 'avant');
    ecrire(dir, {
      'framework/bin/holarch-spawn.js': '// intrusion\n',
      'docs/note.md': '# note\n',
      'mission/OBJECTIVE.md': '# objectif modifié\n',
      'mission/registry/instances/autre-instance.md': '# fiche d’une autre instance\n',
    });
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    const ecarts = ecartsRegle(res, 1);
    assert.equal(ecarts.length, 4);
    const chemins = ecarts.map((e) => e.chemin).sort();
    assert.deepEqual(chemins, [
      'docs/note.md',
      'framework/bin/holarch-spawn.js',
      'mission/OBJECTIVE.md',
      'mission/registry/instances/autre-instance.md',
    ]);
  } finally { nettoyer(dir); }
});

test('règle 1 : écritures dans l’arbre autorisé (soi, shared, registre partagé, fiches descendantes, INBOX parent) — conforme', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal());
    const avant = commit(dir, 'avant');
    ecrire(dir, {
      'mission/concepteur/enfant/JOURNAL.md': '## init\nRien à signaler.\n\n## suite\nToujours rien.\n',
      'mission/shared/concepteur/enfant/livrable.md': '# livrable\n',
      'mission/registry/PROGRESS.md': '# avancement\n',
      'mission/registry/instances/concepteur-enfant.md': fiche(1),
      'mission/registry/instances/concepteur-enfant-petit.md': '# fiche du petit\n',
      'mission/concepteur/INBOX.md': '# boîte du parent\n',
    });
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    assert.deepEqual(ecartsRegle(res, 1), []);
  } finally { nettoyer(dir); }
});

// ================================================================== Règle 2 : transition de STATUS.md

test('règle 2 : WORKING sans note « hibernation volontaire » — un écart', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ etat: 'WORKING' }));
    const avant = commit(dir, 'avant');
    ecrire(dir, arbreNormal({ etat: 'WORKING', note: 'travail en cours' }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    assert.equal(ecartsRegle(res, 2).length, 1);
  } finally { nettoyer(dir); }
});

test('règle 2 : WORKING avec note « hibernation volontaire (contexte) » — conforme', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ etat: 'WORKING' }));
    const avant = commit(dir, 'avant');
    ecrire(dir, arbreNormal({ etat: 'WORKING', note: 'hibernation volontaire (contexte)' }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    assert.deepEqual(ecartsRegle(res, 2), []);
  } finally { nettoyer(dir); }
});

test('règle 2 : WAITING_CHILDREN avec Réveil « — » — un écart', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ etat: 'WAITING_CHILDREN', reveilTxt: 'fichier:x' }));
    const avant = commit(dir, 'avant');
    ecrire(dir, arbreNormal({ etat: 'WAITING_CHILDREN', reveilTxt: '—' }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    assert.equal(ecartsRegle(res, 2).length, 1);
  } finally { nettoyer(dir); }
});

test('règle 2 : WAITING_CHILDREN avec condition de réveil valide — conforme', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ etat: 'WAITING_CHILDREN', reveilTxt: 'fichier:x' }));
    const avant = commit(dir, 'avant');
    ecrire(dir, arbreNormal({ etat: 'WAITING_CHILDREN', reveilTxt: 'lun(enfants:DELIVERED, message:BLOCKER)' }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    assert.deepEqual(ecartsRegle(res, 2), []);
  } finally { nettoyer(dir); }
});

test('règle 2 : transition interdite ARCHIVED → WORKING — un écart « transition interdite »', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ etat: 'ARCHIVED' }));
    const avant = commit(dir, 'avant');
    ecrire(dir, arbreNormal({ etat: 'WORKING', note: 'hibernation volontaire (test)' }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    const ecarts = ecartsRegle(res, 2);
    assert.equal(ecarts.length, 1);
    assert.match(ecarts[0].detail, /transition interdite/);
  } finally { nettoyer(dir); }
});

test('règle 2 : transition INIT → DELIVERED — conforme (KERNEL §3)', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ etat: 'INIT' }));
    const avant = commit(dir, 'avant');
    ecrire(dir, arbreNormal({ etat: 'DELIVERED' }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    assert.deepEqual(ecartsRegle(res, 2), []);
  } finally { nettoyer(dir); }
});

test('règle 2 : constat de blocage dans le journal — écart si aucun message signalé, conforme si BLOCKER émis le même jour', () => {
  const journalBloque = '## 2026-01-15 - session\nConstat : impossible de continuer, blocage détecté.\n';

  // 9a. violation : pas de message dans OUTBOX ni dans l'INBOX du parent.
  let dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ etat: 'WORKING' }));
    const avant = commit(dir, 'avant');
    ecrire(dir, arbreNormal({ etat: 'DELIVERED', journal: journalBloque }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    const ecarts = ecartsRegle(res, 2);
    assert.equal(ecarts.length, 1);
    assert.equal(ecarts[0].chemin, 'mission/concepteur/enfant/JOURNAL.md');
  } finally { nettoyer(dir); }

  // 9b. conformité : BLOCKER émis dans OUTBOX le jour du commit `apres`.
  dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ etat: 'WORKING' }));
    const avant = commit(dir, 'avant');
    ecrire(dir, Object.assign({}, arbreNormal({ etat: 'DELIVERED', journal: journalBloque }), {
      'mission/concepteur/enfant/OUTBOX.md': '---\nfrom: concepteur/enfant\nto: concepteur\ntype: BLOCKER\ndate: 2026-01-15T10:00:00Z\n---\nBlocage signalé.\n',
    }));
    const apres = commit(dir, 'apres', { date: '2026-01-15T10:00:00Z' });
    const res = verifierSession(dir, CHEMIN, avant, apres);
    assert.deepEqual(ecartsRegle(res, 2), []);
  } finally { nettoyer(dir); }
});

// ================================================================== Règle 3 : budget d'enfants

test('règle 3 : deux enfants créés pour un budget alloué de 1 — un écart', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ alloue: 1 }));
    const avant = commit(dir, 'avant');
    ecrire(dir, Object.assign({}, arbreNormal({ alloue: 1 }), {
      'mission/concepteur/enfant/a/ROLE.md': '# Rôle a\n',
      'mission/concepteur/enfant/b/ROLE.md': '# Rôle b\n',
    }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    const ecarts = ecartsRegle(res, 3);
    assert.equal(ecarts.length, 1);
    assert.match(ecarts[0].detail, /budget alloué de 1/);
  } finally { nettoyer(dir); }
});

test('règle 3 : deux enfants créés pour un budget alloué de 2 — conforme', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal({ alloue: 2 }));
    const avant = commit(dir, 'avant');
    ecrire(dir, Object.assign({}, arbreNormal({ alloue: 2 }), {
      'mission/concepteur/enfant/a/ROLE.md': '# Rôle a\n',
      'mission/concepteur/enfant/b/ROLE.md': '# Rôle b\n',
    }));
    const apres = commit(dir, 'apres');
    const res = verifierSession(dir, CHEMIN, avant, apres);
    assert.deepEqual(ecartsRegle(res, 3), []);
  } finally { nettoyer(dir); }
});

// ================================================================== Dépôt inexploitable (fail-open)

test('fail-open : root n’est pas un dépôt Git — {ecarts: []}', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-non-depot-'));
  try {
    const res = verifierSession(dir, CHEMIN, 'peu-importe1', 'peu-importe2');
    assert.deepEqual(res, { ecarts: [] });
  } finally { nettoyer(dir); }
});

test('fail-open : shas avant/après inexistants — {ecarts: []}', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal());
    commit(dir, 'seul commit');
    const res = verifierSession(dir, CHEMIN, 'deadbee', 'deadbee');
    assert.deepEqual(res, { ecarts: [] });
  } finally { nettoyer(dir); }
});

test('fail-open : root inexistant et arguments vides — {ecarts: []}', () => {
  const res = verifierSession('', '', '', '');
  assert.deepEqual(res, { ecarts: [] });
});

// 1.19.3 : avec `opts.prefixes`, seuls les commits de l'instance sont jugés — pas ceux d'une session de
// maintenance tombés dans l'intervalle (racine sur l'arbre principal partagé, holarch-modeles 2026-09-12).
test('règle 1 : avec prefixes, un commit de maintenance dans l’intervalle n’est pas un écart, un commit [chemin] l’est', () => {
  const dir = creerDepot();
  try {
    ecrire(dir, arbreNormal());
    const avant = commit(dir, 'avant');
    ecrire(dir, { 'framework/VERSION': '9.9.9\n', 'docs/note.md': '# maintenance\n' });
    commit(dir, 'Framework 9.9.9 : patch de maintenance');
    ecrire(dir, { 'mission/registry/PROGRESS.md': '# ok\n' });
    commit(dir, `[${CHEMIN}] U1 : progrès`);
    ecrire(dir, { 'framework/bin/x.js': '// intrusion\n' });
    const apres = commit(dir, `[${CHEMIN}] U2 : intrusion`);
    const prefixes = [`[${CHEMIN}]`, '[bootstrap]', '[harnais]', 'review('];
    const ecarts = ecartsRegle(verifierSession(dir, CHEMIN, avant, apres, { prefixes }), 1);
    assert.deepEqual(ecarts.map((e) => e.chemin), ['framework/bin/x.js']);
    // Sans prefixes : comportement d'origine, tout l'intervalle est jugé.
    assert.equal(ecartsRegle(verifierSession(dir, CHEMIN, avant, apres), 1).length, 3);
  } finally { nettoyer(dir); }
});

