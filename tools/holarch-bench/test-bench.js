'use strict';
// Tests de bench.js — `node --test test-bench.js` (Node ≥ 18, aucune dépendance).
// §6.3 IMPLEMENTATION.md : `--calibrer` sur docs/archive/mission-holon-v2/registry/SESSIONS.md doit
// rester stable (non-régression avec tolérance), format à dix colonnes reconnu. Le fichier vit à deux
// emplacements possibles selon le stade (paquet sous mission/shared/... avant promotion, puis
// tools/holarch-bench/ après) : `trouverArchive` remonte l'arborescence pour rester valide aux deux.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const bench = require('./bench');

function trouverArchive(depuis, relatif) {
  let dir = depuis;
  for (let i = 0; i < 12; i++) {
    const p = path.join(dir, relatif);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

const ARCHIVE_HOLON_V2 = trouverArchive(__dirname, 'docs/archive/mission-holon-v2/registry/SESSIONS.md');

function prochePct(actual, attendu, tolerancePct) {
  if (attendu === 0) return actual === 0;
  return Math.abs(actual - attendu) / Math.abs(attendu) <= tolerancePct;
}

// --- Fonctions élémentaires ---

test('parseNumberCell : vide, "?", "—" → null ; nombre valide → nombre', () => {
  assert.equal(bench.parseNumberCell(''), null);
  assert.equal(bench.parseNumberCell('?'), null);
  assert.equal(bench.parseNumberCell('—'), null);
  assert.equal(bench.parseNumberCell(undefined), null);
  assert.equal(bench.parseNumberCell('42'), 42);
  assert.equal(bench.parseNumberCell(' 3.5 '), 3.5);
});

test('parseTokensCell : entrée/cache lu/cache écrit (sortie exclue), "—" → null', () => {
  assert.equal(bench.parseTokensCell('100 / 200 / 300 / 999'), 600);
  assert.equal(bench.parseTokensCell('1/2/3'), 6);
  assert.equal(bench.parseTokensCell('—'), null);
  assert.equal(bench.parseTokensCell(''), null);
  assert.equal(bench.parseTokensCell('1/2'), null); // moins de 3 parts : malformé
});

test('parseReveilCell : système + utilisateur, "—" → null', () => {
  assert.equal(bench.parseReveilCell('12000 / 3000'), 15000);
  assert.equal(bench.parseReveilCell('—'), null);
  assert.equal(bench.parseReveilCell('12000'), null); // moins de 2 parts : malformé
});

test('median / p90 : valeurs connues', () => {
  assert.equal(bench.median([1, 2, 3]), 2);
  assert.equal(bench.median([1, 2, 3, 4]), 2.5);
  assert.equal(bench.median([]), null);
  assert.equal(bench.p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(bench.p90([]), null);
});

// --- chantier 6 : contexte instantané ---

test('parseContexteInstantCell : "d / m" -> {depart,max} ; vide/tiret -> null', () => {
  assert.deepEqual(bench.parseContexteInstantCell('45000 / 98000'), { depart: 45000, max: 98000 });
  assert.equal(bench.parseContexteInstantCell('—'), null);
  assert.equal(bench.parseContexteInstantCell('— / —'), null);
  assert.equal(bench.parseContexteInstantCell(''), null);
  assert.equal(bench.parseContexteInstantCell(undefined), null);
  assert.equal(bench.parseContexteInstantCell('45000'), null); // 1 part : malformé
});

test('calibrer : colonne Contexte (départ / max) -> stats.contexteInstantane + seuil sur p90(max)', () => {
  const texte = [
    '| Instance | Contexte (départ / max) |',
    '|---|---|',
    '| a | 10000 / 50000 |',
    '| a | 20000 / 150000 |',
    '| b | 15000 / 100000 |',
  ].join('\n');
  const r = bench.calibrer(texte);
  assert.equal(r.fichier.contexteInstantPresent, true);
  assert.equal(r.stats.contexteInstantane.n, 3);
  assert.equal(r.stats.contexteInstantane.departMediane, 15000);
  assert.equal(r.stats.contexteInstantane.maxMediane, 100000);
  // p90([50000,100000,150000]) -> idx = ceil(0.9*3)-1 = 2 -> 150000 ; arrondi /5000 déjà multiple
  assert.equal(r.propositions.seuil_contexte_tokens, 150000);
  assert.equal(r.propositions.part_contexte_fixe, 15000 / 120000);
});

test('reconstituerSessionTranscription : fixture 5 tours, lignes bruit/malformées ignorées', () => {
  const p = path.join(__dirname, 'fixtures', 'exemple-cinq-tours.jsonl');
  const r = bench.reconstituerSessionTranscription(p);
  assert.deepEqual(r, { depart: 1000, max: 3000, tours: 5 });
});

test('reconstituerSessionTranscription : fichier introuvable -> null', () => {
  assert.equal(bench.reconstituerSessionTranscription(path.join(__dirname, 'fixtures', 'absent.jsonl')), null);
});

test('sessionsMdDepuisTranscriptions : dossier -> { md, subagents }, md réinjectable dans calibrer', () => {
  const dossier = path.join(__dirname, 'fixtures');
  const { md, subagents } = bench.sessionsMdDepuisTranscriptions(dossier);
  assert.match(md, /exemple-cinq-tours \| 5 \| 1000 \/ 3000/);
  const r = bench.calibrer(md);
  assert.equal(r.stats.contexteInstantane.n, 1);
  // fixtures/ ne contient que le fichier plat exemple-cinq-tours.jsonl à sa racine directe : le
  // sous-dossier subagents-demo/ (utilisé par les tests U7 ci-dessous) n'a pas de jsonl racine
  // directement sous lui-même (il est niché un niveau plus bas, sous session-abc/) donc il est
  // silencieusement ignoré ici — aucune interférence entre les deux jeux de fixtures.
  assert.deepEqual(subagents, []);
});

// --- U7 : sous-dossier <sid>/ avec jsonl racine (instance) + subagents/*.jsonl ---

test('sommerUsageTranscription : somme cumulée (pas départ/max) sur toutes les lignes assistant/usage', () => {
  const p = path.join(__dirname, 'fixtures', 'subagents-demo', 'session-abc', 'subagents', 'agent-x.jsonl');
  const u = bench.sommerUsageTranscription(p);
  // tour 1 : 500+0 = 500 ; tour 2 : 600+100 = 700 ; total 1200
  assert.deepEqual(u, { tours: 2, total: 1200 });
});

test('sommerUsageTranscription : fichier introuvable -> null', () => {
  assert.equal(bench.sommerUsageTranscription(path.join(__dirname, 'fixtures', 'absent.jsonl')), null);
});

test('sessionsMdDepuisTranscriptions : dossier <sid>/ + subagents/*.jsonl -> md sans les sous-agents, subagents à part', () => {
  const dossier = path.join(__dirname, 'fixtures', 'subagents-demo');
  const { md, subagents } = bench.sessionsMdDepuisTranscriptions(dossier);
  // la session racine (instance) apparaît dans md, comme le format plat
  assert.match(md, /\| session-abc \| 3 \| 2000 \/ 4500 \|/);
  // les tokens des sous-agents ne figurent JAMAIS dans md (jamais vus par calibrer, jamais mélangés
  // aux stats de l'instance)
  assert.doesNotMatch(md, /agent-x/);
  assert.doesNotMatch(md, /agent-y/);
  assert.doesNotMatch(md, /1200/);
  assert.doesNotMatch(md, /1550/);
  // agrégat séparé, par session : agent-x (1200 tokens, 2 tours) + agent-y (350 tokens, 1 tour)
  assert.deepEqual(subagents, [{ session: 'session-abc', nSousAgents: 2, tokens: 1550, tours: 3 }]);
  // et les stats de l'instance (calibrer sur md seul) restent celles de la seule session racine
  const r = bench.calibrer(md);
  assert.equal(r.stats.contexteInstantane.n, 1);
  assert.equal(r.stats.contexteInstantane.departMediane, 2000);
  assert.equal(r.stats.contexteInstantane.maxMediane, 4500);
});

test('formatCalibrerReport : section sous-agents séparée, tokens jamais additionnés au total instance', () => {
  const dossier = path.join(__dirname, 'fixtures', 'subagents-demo');
  const { md, subagents } = bench.sessionsMdDepuisTranscriptions(dossier);
  const r = bench.calibrer(md);
  const rapportSansSubagents = bench.formatCalibrerReport(dossier, r);
  const rapportAvecSubagents = bench.formatCalibrerReport(dossier, r, subagents);
  // sans sous-agents passés : pas de section
  assert.doesNotMatch(rapportSansSubagents, /sous-agents/);
  // avec sous-agents : section présente, avec le détail par session et le total
  assert.match(rapportAvecSubagents, /Tokens et coût des sous-agents/);
  assert.match(rapportAvecSubagents, /session session-abc — 2 sous-agent\(s\), 1550 tokens/);
  assert.match(rapportAvecSubagents, /total — 1 session\(s\), 2 sous-agent\(s\), 3 tour\(s\), 1550 tokens/);
  // pas de coût USD inventé pour les sous-agents (pas de table de tarification dans bench.js)
  assert.match(rapportAvecSubagents, /pas de coût calculé/);
  // le reste du rapport (stats de l'instance) est strictement identique, avec ou sans la section
  // sous-agents : la présence des sous-agents ne modifie JAMAIS les totaux de l'instance.
  const prefixeCommun = rapportSansSubagents;
  assert.equal(rapportAvecSubagents.startsWith(prefixeCommun), true);
});

test('CLI --calibrer --transcriptions <dossier <sid>/+subagents> : section sous-agents dans la sortie, distincte du contexte instance', () => {
  const dossier = path.join(__dirname, 'fixtures', 'subagents-demo');
  const res = spawnSync(process.execPath, [path.join(__dirname, 'bench.js'), '--calibrer', '--transcriptions', dossier], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Contexte instantané/);
  assert.match(res.stdout, /1 session/);
  assert.match(res.stdout, /Tokens et coût des sous-agents/);
  assert.match(res.stdout, /1550 tokens/);
  assert.match(res.stdout, /pas de coût calculé/);
});

test('CLI --calibrer --transcriptions <dossier> : code 0, contexte instantané dans la sortie', () => {
  const dossier = path.join(__dirname, 'fixtures');
  const res = spawnSync(process.execPath, [path.join(__dirname, 'bench.js'), '--calibrer', '--transcriptions', dossier], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Contexte instantané/);
  assert.match(res.stdout, /1 session/);
});

test('CLI --calibrer --transcriptions sans dossier : code 1', () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'bench.js'), '--calibrer', '--transcriptions'], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /requiert un chemin de dossier/);
});

test('findCol : insensible à la casse, par sous-chaîne', () => {
  const headers = ['Date', 'Coût USD', 'Tours', 'Instance'];
  assert.equal(bench.findCol(headers, ['coût', 'cout']), 'Coût USD');
  assert.equal(bench.findCol(headers, ['inexistant']), null);
});

// --- parseSessionsMd : deux formats réels (10 et 11 colonnes) ---

test('parseSessionsMd : reconnaît un tableau à 10 colonnes (format holon-v2)', () => {
  const texte = [
    '| Date | Instance | Session | Modèle | Effort | Tours | Tokens (entrée/cache lu/cache écrit/sortie) | Coût USD | Statut final | Note |',
    '|---|---|---|---|---|---|---|---|---|---|',
    '| 2026-01-01 | concepteur | 1 | sonnet | high | 10 | 100/50/20/5 | 1.23 | DELIVERED | — |',
  ].join('\n');
  const { headers, rows } = bench.parseSessionsMd(texte);
  assert.equal(headers.length, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Instance, 'concepteur');
});

test('parseSessionsMd : reconnaît un tableau à 11 colonnes (format avec Réveil)', () => {
  const texte = [
    '| Date | Instance | Session | Modèle | Effort | Tours | Tokens (entrée/cache lu/cache écrit/sortie) | Réveil (car. système/utilisateur) | Coût USD | Statut final | Note |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    '| 2026-01-01 | concepteur | 1 | sonnet | high | 10 | 100/50/20/5 | 8000/2000 | 1.23 | DELIVERED | — |',
  ].join('\n');
  const { headers, rows } = bench.parseSessionsMd(texte);
  assert.equal(headers.length, 11);
  assert.equal(rows.length, 1);
});

test('parseSessionsMd : ignore les lignes hors tableau et les lignes mal formées', () => {
  const texte = [
    '# Titre, pas un tableau',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    'une ligne quelconque',
    '| 3 |', // trop peu de cellules : ignorée
    '| 4 | 5 |',
  ].join('\n');
  const { rows } = bench.parseSessionsMd(texte);
  assert.equal(rows.length, 2);
});

// --- calibrer() sur un petit jeu de données synthétique, calculé à la main ---

test('calibrer : statistiques exactes sur un jeu synthétique de 3 sessions', () => {
  const texte = [
    '| Instance | Coût USD | Tours | Tokens (entrée/cache lu/cache écrit/sortie) |',
    '|---|---|---|---|',
    '| a | 1.00 | 10 | 100/0/0/0 |',
    '| a | 2.00 | 20 | 200/0/0/0 |', // 2e session de "a" → 1 hibernation
    '| b | 3.00 | 30 | 300/0/0/0 |',
  ].join('\n');
  const r = bench.calibrer(texte);
  assert.equal(r.fichier.nSessions, 3);
  assert.equal(r.fichier.nInstances, 2);
  assert.equal(r.fichier.reveilPresent, false);
  assert.equal(r.stats.coutUSD.mediane, 2);
  assert.equal(r.stats.tours.mediane, 20);
  assert.equal(r.stats.contexteTokens.mediane, 200);
  assert.equal(r.stats.totalHibernations, 1); // "a" a 2 sessions → 1 hibernation ; "b" en a 1 → 0
  assert.equal(r.stats.hibernationsParSession, 1 / 3);
});

// --- Non-régression (§6.3) : archive réelle mission-holon-v2, format à dix colonnes ---

test('calibrer : non-régression sur docs/archive/mission-holon-v2/registry/SESSIONS.md (format 10 colonnes)', { skip: !ARCHIVE_HOLON_V2 && 'archive introuvable depuis ce chemin' }, () => {
  const texte = fs.readFileSync(ARCHIVE_HOLON_V2, 'utf8');
  const r = bench.calibrer(texte);
  // Valeurs de référence collées de la sortie réelle de bench.js --calibrer (memoire/U7 de cette
  // instance) — tolérance de 1 % sur les grandeurs statistiques : garde-fou contre une régression de
  // calcul, pas contre l'évolution légitime du fichier archivé (qui ne change plus, il est archivé).
  assert.equal(r.fichier.nSessions, 130);
  assert.equal(r.fichier.nInstances, 22);
  assert.equal(r.fichier.reveilPresent, false);
  assert.ok(prochePct(r.stats.coutUSD.mediane, 2.67, 0.01), `médiane coût = ${r.stats.coutUSD.mediane}`);
  assert.ok(prochePct(r.stats.coutUSD.p90, 4.17, 0.01), `p90 coût = ${r.stats.coutUSD.p90}`);
  assert.ok(prochePct(r.stats.tours.mediane, 22, 0.01), `médiane tours = ${r.stats.tours.mediane}`);
  assert.ok(prochePct(r.stats.tours.p90, 52, 0.01), `p90 tours = ${r.stats.tours.p90}`);
  assert.ok(prochePct(r.stats.contexteTokens.mediane, 1559158, 0.01), `médiane tokens = ${r.stats.contexteTokens.mediane}`);
  assert.ok(prochePct(r.stats.contexteTokens.p90, 3976380, 0.01), `p90 tokens = ${r.stats.contexteTokens.p90}`);
  assert.equal(r.stats.totalHibernations, 108);
});

// --- CLI : smoke test de --calibrer via un sous-processus réel ---

test('CLI --calibrer : code 0, sortie contient "Valeurs proposées"', { skip: !ARCHIVE_HOLON_V2 && 'archive introuvable depuis ce chemin' }, () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'bench.js'), '--calibrer', ARCHIVE_HOLON_V2], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Valeurs proposées/);
  assert.match(res.stdout, /130 session/);
});

test('CLI --calibrer sans argument : code 1, message d\'usage', () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'bench.js'), '--calibrer'], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /requiert un chemin/);
});

test('CLI sans argument reconnu : code 1, usage imprimé', () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'bench.js')], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Usage/);
});
