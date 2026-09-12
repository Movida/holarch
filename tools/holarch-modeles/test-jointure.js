'use strict';
/**
 * Tests de `jointure.js`, hermétiques : chaque cas construit sa propre mission de fixture sous
 * `os.tmpdir()` (`fs.mkdtempSync`) et la nettoie ensuite. Aucune lecture de `docs/archive/`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseSessions, collecterFiches, joindre, formatTable, formatJson,
  parseDureeMs, parseCoutUsd, parseContexte,
} = require('./jointure.js');

const HEADER_FULL = '| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens (entrée / cache lu / cache écrit / sortie) | Coût USD | Durée | Fin | STATUS | Réveil (car. système / utilisateur) | Contexte (départ / max) | Fournisseur / modèle réel |';
const SEP_FULL = '|---|---|---|---|---|---|---|---|---|---|---|---|---|';

function ligneComplete({ date, instance, session, modele, tours, tokens, cout, duree, finResume, status, reveil, contexte, fournisseur }) {
  return `| ${date} | ${instance} | ${session} | ${modele} | ${tours} | ${tokens} | ${cout} | ${duree} | ${finResume} | ${status} | ${reveil} | ${contexte} | ${fournisseur} |`;
}

function ligneAncienne11({ date, instance, session, modele, tours, tokens, cout, duree, finResume, status, reveil }) {
  // Ligne à 11 cellules : ni Contexte, ni Fournisseur (colonnes ajoutées plus tard).
  return `| ${date} | ${instance} | ${session} | ${modele} | ${tours} | ${tokens} | ${cout} | ${duree} | ${finResume} | ${status} | ${reveil} |`;
}

function ficheTexte(champs, corps) {
  const lignes = ['---'];
  for (const [k, v] of Object.entries(champs)) lignes.push(`${k}: ${v}`);
  lignes.push('---');
  if (corps) lignes.push(corps);
  return lignes.join('\n') + '\n';
}

function creerMission(sessionsContent, fiches) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jointure-test-'));
  fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, 'registry', 'SESSIONS.md'), sessionsContent);
  for (const f of fiches) {
    const full = path.join(root, f.chemin);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.contenu);
  }
  return root;
}

function nettoyer(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('rattachement nominal : fiche dans l\'intervalle [fin-durée, fin]', () => {
  const sessions = [
    HEADER_FULL, SEP_FULL,
    ligneComplete({
      date: '2026-01-01T10:00:00Z', instance: 'concepteur', session: 's1', modele: 'claude-sonnet-5/high',
      tours: 10, tokens: '1 / 2 / 3 / 4', cout: '1.5000', duree: '10m00s', finResume: 'success', status: 'WORKING',
      reveil: '100 / 10', contexte: '1000 / 2000', fournisseur: 'anthropic / claude-sonnet-5',
    }),
  ].join('\n');
  const root = creerMission(sessions, [
    { chemin: 'concepteur/memoire/U1-test.md', contenu: ficheTexte({ id: 'U1', date: '2026-01-01T09:55:00Z', critere: 'x', resultat: 'PASS', preuve: 'y', commit: '—' }) },
  ]);
  try {
    const s = parseSessions(fs.readFileSync(path.join(root, 'registry', 'SESSIONS.md'), 'utf8'));
    const f = collecterFiches(root);
    const res = joindre(s, f, { missionRoot: root });
    assert.equal(res.fiches_non_rattachees.length, 0);
    assert.equal(res.sessions.length, 1);
    assert.deepEqual(res.sessions[0].unites, ['U1']);
    assert.equal(res.sessions[0].cout_par_unite, 1.5);
  } finally { nettoyer(root); }
});

test('fiche hors intervalle → non rattachée, motif "hors de tout intervalle de session"', () => {
  const sessions = [
    HEADER_FULL, SEP_FULL,
    ligneComplete({
      date: '2026-01-01T10:00:00Z', instance: 'concepteur', session: 's1', modele: 'claude-sonnet-5/high',
      tours: 10, tokens: '1 / 2 / 3 / 4', cout: '1.5000', duree: '10m00s', finResume: 'success', status: 'WORKING',
      reveil: '100 / 10', contexte: '1000 / 2000', fournisseur: '—',
    }),
  ].join('\n');
  const root = creerMission(sessions, [
    { chemin: 'concepteur/memoire/U1-test.md', contenu: ficheTexte({ id: 'U1', date: '2026-01-01T08:00:00Z', critere: 'x', resultat: 'PASS', preuve: 'y', commit: '—' }) },
  ]);
  try {
    const s = parseSessions(fs.readFileSync(path.join(root, 'registry', 'SESSIONS.md'), 'utf8'));
    const f = collecterFiches(root);
    const res = joindre(s, f, { missionRoot: root });
    assert.equal(res.fiches_non_rattachees.length, 1);
    assert.equal(res.fiches_non_rattachees[0].motif, 'hors de tout intervalle de session');
    assert.equal(res.sessions[0].unites.length, 0);
  } finally { nettoyer(root); }
});

test('instance sans session → motif "aucune session pour cette instance"', () => {
  const sessions = [
    HEADER_FULL, SEP_FULL,
    ligneComplete({
      date: '2026-01-01T10:00:00Z', instance: 'concepteur', session: 's1', modele: 'claude-sonnet-5/high',
      tours: 10, tokens: '1 / 2 / 3 / 4', cout: '1.5000', duree: '10m00s', finResume: 'success', status: 'WORKING',
      reveil: '100 / 10', contexte: '1000 / 2000', fournisseur: '—',
    }),
  ].join('\n');
  const root = creerMission(sessions, [
    { chemin: 'concepteur/autre-instance/memoire/U1-test.md', contenu: ficheTexte({ id: 'U1', date: '2026-01-01T09:55:00Z', critere: 'x', resultat: 'PASS', preuve: 'y', commit: '—' }) },
  ]);
  try {
    const s = parseSessions(fs.readFileSync(path.join(root, 'registry', 'SESSIONS.md'), 'utf8'));
    const f = collecterFiches(root);
    const res = joindre(s, f, { missionRoot: root });
    assert.equal(res.fiches_non_rattachees.length, 1);
    assert.equal(res.fiches_non_rattachees[0].motif, 'aucune session pour cette instance');
  } finally { nettoyer(root); }
});

test('ligne de session ancienne à colonnes manquantes → null sans exception', () => {
  const sessions = [
    HEADER_FULL, SEP_FULL,
    ligneAncienne11({
      date: '2026-01-01T10:00:00Z', instance: 'concepteur', session: 's0', modele: 'claude-opus-5/high',
      tours: 5, tokens: '1 / 2 / 3 / 4', cout: '0.8000', duree: '5m00s', finResume: 'success', status: 'WORKING',
      reveil: '50 / 5',
    }),
  ].join('\n');
  assert.doesNotThrow(() => parseSessions(sessions));
  const s = parseSessions(sessions);
  assert.equal(s.length, 1);
  assert.equal(s[0].contexte, null);
  assert.equal(s[0].contexte_brut, null);
  assert.equal(s[0].fournisseur, null);
});

test('coût "≈ 0.23" → valeur 0.23, approximatif vrai ; "?" → null', () => {
  assert.deepEqual(parseCoutUsd('≈ 0.23'), { valeur: 0.23, approximatif: true });
  assert.equal(parseCoutUsd('?'), null);
  assert.deepEqual(parseCoutUsd('0.2033'), { valeur: 0.2033, approximatif: false });
});

test('parseDureeMs accepte 43s, 6m58s, 1h02m03s', () => {
  assert.equal(parseDureeMs('43s'), 43000);
  assert.equal(parseDureeMs('6m58s'), 6 * 60000 + 58000);
  assert.equal(parseDureeMs('1h02m03s'), 3600000 + 2 * 60000 + 3000);
});

test('deux instances distinctes : aucun mélange de leurs fiches', () => {
  const sessions = [
    HEADER_FULL, SEP_FULL,
    ligneComplete({
      date: '2026-01-01T10:00:00Z', instance: 'concepteur', session: 's1', modele: 'claude-sonnet-5/high',
      tours: 10, tokens: '1 / 2 / 3 / 4', cout: '1.0000', duree: '10m00s', finResume: 'success', status: 'WORKING',
      reveil: '100 / 10', contexte: '1000 / 2000', fournisseur: '—',
    }),
    ligneComplete({
      date: '2026-01-01T10:05:00Z', instance: 'concepteur/implementeur-x', session: 's2', modele: 'claude-sonnet-5/high',
      tours: 8, tokens: '1 / 2 / 3 / 4', cout: '2.0000', duree: '5m00s', finResume: 'success', status: 'WORKING',
      reveil: '100 / 10', contexte: '1000 / 2000', fournisseur: '—',
    }),
  ].join('\n');
  const root = creerMission(sessions, [
    { chemin: 'concepteur/memoire/U1-test.md', contenu: ficheTexte({ id: 'U1', date: '2026-01-01T09:56:00Z', critere: 'x', resultat: 'PASS', preuve: 'y', commit: '—' }) },
    { chemin: 'concepteur/implementeur-x/memoire/U1-test.md', contenu: ficheTexte({ id: 'U1', date: '2026-01-01T10:02:00Z', critere: 'x', resultat: 'PASS', preuve: 'y', commit: '—' }) },
  ]);
  try {
    const s = parseSessions(fs.readFileSync(path.join(root, 'registry', 'SESSIONS.md'), 'utf8'));
    const f = collecterFiches(root);
    assert.equal(f.length, 2);
    const res = joindre(s, f, { missionRoot: root });
    const sessConcepteur = res.sessions.find((x) => x.instance === 'concepteur');
    const sessEnfant = res.sessions.find((x) => x.instance === 'concepteur/implementeur-x');
    assert.deepEqual(sessConcepteur.unites, ['U1']);
    assert.deepEqual(sessEnfant.unites, ['U1']);
    assert.equal(res.fiches_non_rattachees.length, 0);
  } finally { nettoyer(root); }
});

test('--format json : sortie analysable par JSON.parse', () => {
  const sessions = [
    HEADER_FULL, SEP_FULL,
    ligneComplete({
      date: '2026-01-01T10:00:00Z', instance: 'concepteur', session: 's1', modele: 'claude-sonnet-5/high',
      tours: 10, tokens: '1 / 2 / 3 / 4', cout: '1.5000', duree: '10m00s', finResume: 'success', status: 'WORKING',
      reveil: '100 / 10', contexte: '1000 / 2000', fournisseur: '—',
    }),
  ].join('\n');
  const root = creerMission(sessions, [
    { chemin: 'concepteur/memoire/U1-test.md', contenu: ficheTexte({ id: 'U1', date: '2026-01-01T09:55:00Z', critere: 'x', resultat: 'PASS', preuve: 'y', commit: '—' }) },
  ]);
  try {
    const s = parseSessions(fs.readFileSync(path.join(root, 'registry', 'SESSIONS.md'), 'utf8'));
    const f = collecterFiches(root);
    const res = joindre(s, f, { missionRoot: root });
    const texte = formatJson(res);
    const parsed = JSON.parse(texte);
    assert.equal(parsed.sessions.length, 1);
    assert.equal(parsed.totaux.fiches_total, 1);

    const texteTable = formatTable(res);
    assert.match(texteTable, /<!-- mission :/);
    assert.match(texteTable, /U1/);
  } finally { nettoyer(root); }
});

test('contexte "— / —" → null ; contexte valide → {depart, max}', () => {
  assert.equal(parseContexte('— / —'), null);
  assert.deepEqual(parseContexte('53529 / 136512'), { depart: 53529, max: 136512 });
});

test('--mission inexistant → main() renvoie le code 2', () => {
  const { main } = require('./jointure.js');
  const dirInexistant = path.join(os.tmpdir(), 'jointure-inexistant-' + Date.now());
  const code = main(['--mission', dirInexistant]);
  assert.equal(code, 2);
});
