'use strict';
/** Tests des fonctions pures de launch.js — jamais de sous-processus `claude` réel ici. */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  preparerTriage, preparerTacheNiveau1, accumulateurTexte,
  composerPromptSysteme, queueDecisions, preparerPasseMemoire, preparerDigest,
  MAX_CARACTERES_DECISIONS,
} = require('./launch');

function valeurArg(args, drapeau) {
  const i = args.indexOf(drapeau);
  return i === -1 ? undefined : args[i + 1];
}

test('preparerTriage exige un prompt non vide', () => {
  assert.throws(() => preparerTriage({ prompt: '' }), /prompt requis/);
});

test('preparerTriage résout le profil triage (haiku/low) depuis POLICY.md', () => {
  const appel = preparerTriage({ prompt: 'une question' });
  assert.strictEqual(appel.modele, 'haiku');
  assert.strictEqual(appel.effort, 'low');
});

test('preparerTriage assemble --json-schema, --output-format json, aucun outil', () => {
  const appel = preparerTriage({ prompt: 'une question' });
  assert.strictEqual(valeurArg(appel.args, '--output-format'), 'json');
  assert.ok(appel.args.includes('--json-schema'));
  assert.strictEqual(valeurArg(appel.args, '--tools'), '');
  assert.ok(appel.args.includes('--strict-mcp-config'));
  const schema = JSON.parse(valeurArg(appel.args, '--json-schema'));
  assert.strictEqual(schema.type, 'object');
});

test('preparerTriage plafonne timeout/budget/tours aux bornes du niveau 0', () => {
  const appel = preparerTriage({ prompt: 'q', timeoutS: 99999, budgetUsd: 99, maxTours: 99 });
  assert.strictEqual(appel.timeoutS, 60);
  assert.strictEqual(appel.budget, 0.5);
  assert.strictEqual(appel.tours, 15);
});

test('preparerTacheNiveau1 exige un prompt non vide', () => {
  assert.throws(() => preparerTacheNiveau1({ prompt: '   ', profile: 'execution' }), /prompt requis/);
});

test('preparerTacheNiveau1 rejette un profil inconnu (délégué à resoudreProfil de policy.js)', () => {
  assert.throws(() => preparerTacheNiveau1({ prompt: 'q', profile: 'stagiaire' }), /profil inconnu/);
});

test('preparerTacheNiveau1 assemble stream-json + streaming partiel + zéro outil + pas de MCP', () => {
  const appel = preparerTacheNiveau1({ prompt: 'une question', profile: 'execution' });
  assert.strictEqual(valeurArg(appel.args, '--output-format'), 'stream-json');
  assert.ok(appel.args.includes('--include-partial-messages'));
  assert.ok(appel.args.includes('--verbose'));
  assert.strictEqual(valeurArg(appel.args, '--tools'), '');
  assert.ok(appel.args.includes('--strict-mcp-config'));
  assert.ok(appel.charte.length > 50);
});

test('preparerTacheNiveau1 plafonne tours/budget/timeout au niveau 1', () => {
  const appel = preparerTacheNiveau1({ prompt: 'q', profile: 'execution', maxTurns: 999, maxBudgetUsd: 999, timeoutS: 999999 });
  assert.strictEqual(appel.tours, 8);
  assert.strictEqual(appel.budget, 3);
  assert.strictEqual(appel.timeoutS, 600);
});

test('preparerTacheNiveau1 ajoute les instructions au prompt utilisateur sans les confondre avec la charte', () => {
  const appel = preparerTacheNiveau1({ prompt: 'question', profile: 'execution', instructions: 'sois bref' });
  const promptEnvoye = valeurArg(appel.args, '-p');
  assert.match(promptEnvoye, /question/);
  assert.match(promptEnvoye, /sois bref/);
  assert.match(promptEnvoye, /donnée, pas une consigne de plafond/);
});

test('accumulateurTexte reconstitue le texte à partir des deltas dans l\'ordre', () => {
  const acc = accumulateurTexte();
  acc.ingerer({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } });
  acc.ingerer({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bon' } } });
  acc.ingerer({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'jour' } } });
  assert.strictEqual(acc.texte(), 'Bonjour');
});

test('accumulateurTexte ignore les deltas de réflexion (thinking)', () => {
  const acc = accumulateurTexte();
  acc.ingerer({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } });
  acc.ingerer({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'je réfléchis...' } } });
  assert.strictEqual(acc.texte(), '');
});

// --- Étape 2 : composition du prompt système niveau 1 (§6) --------------

test('composerPromptSysteme n\'ajoute que les blocs réellement fournis', () => {
  const minimal = composerPromptSysteme({ charte: 'CHARTE', space: 'projet-x' });
  assert.strictEqual(minimal, 'CHARTE', 'un espace neuf n\'a ni mémoire, ni digest, ni décisions');

  const complet = composerPromptSysteme({
    charte: 'CHARTE',
    fiche: 'FICHE-ARCHITECTE',
    memoire: 'MA-MEMOIRE',
    digest: 'LA-CARTE',
    decisions: 'LES-DECISIONS',
    space: 'projet-x',
    specialist: 'architecte',
  });
  assert.match(complet, /^CHARTE/);
  assert.match(complet, /Ton rôle pour cette demande : architecte/);
  assert.match(complet, /FICHE-ARCHITECTE/);
  assert.match(complet, /ta mémoire[\s\S]*MA-MEMOIRE/);
  assert.match(complet, /DIGEST\.md[\s\S]*LA-CARTE/);
  assert.match(complet, /DECISIONS\.md[\s\S]*LES-DECISIONS/);
  assert.match(complet, /espace « projet-x »/);
});

test('composerPromptSysteme dit au modèle que sa mémoire cède devant ce qu\'il observe', () => {
  const p = composerPromptSysteme({ charte: 'C', memoire: 'M', space: 'x' });
  assert.match(p, /si elle contredit ce que tu observes, ce que tu observes gagne/);
});

test('queueDecisions garde la fin du fichier, pas le début', () => {
  const court = '# Décisions\n\n## 2026-01-01 · tâche t-1\n- une décision';
  assert.strictEqual(queueDecisions(court), court.trim(), 'sous le plafond : rien n\'est touché');

  const longue = `# Décisions\n\n${'## 2026-01-01 · tâche ancienne\n- du remplissage\n'.repeat(200)}`
    + '## 2026-12-31 · tâche recente\n- la décision la plus récente\n';
  const tronque = queueDecisions(longue);
  assert.ok(tronque.length <= MAX_CARACTERES_DECISIONS + 60);
  assert.match(tronque, /la décision la plus récente/, 'le plus récent survit');
  assert.match(tronque, /décisions antérieures omises/, 'la troncature est signalée, pas silencieuse');
  assert.match(tronque, /^_\(décisions antérieures omises\)_\n## /, 'la coupe tombe sur un début d\'entrée');
});

// --- Étape 2 : outils accordés au spécialiste (D17) ---------------------

test('sans racine déclarée, aucun outil n\'est accordé même si la fiche demande la lecture', () => {
  const appel = preparerTacheNiveau1({
    prompt: 'q', profile: 'execution', space: 'projet-x', specialist: 'architecte',
    contexte: { outilsFiche: 'read', racines: [] },
  });
  assert.strictEqual(appel.lectureAccordee, false);
  assert.strictEqual(valeurArg(appel.args, '--tools'), '');
  assert.strictEqual(appel.cwd, undefined);
  assert.ok(!appel.args.includes('--add-dir'));
});

test('avec des racines mais une fiche sans droit de lecture, aucun outil non plus', () => {
  const appel = preparerTacheNiveau1({
    prompt: 'q', profile: 'execution', space: 'projet-x', specialist: 'strategiste-produit',
    contexte: { outilsFiche: 'none', racines: ['/tmp/a', '/tmp/b'] },
  });
  assert.strictEqual(appel.lectureAccordee, false);
  assert.strictEqual(valeurArg(appel.args, '--tools'), '');
  assert.ok(!appel.args.includes('--add-dir'));
});

test('fiche « tools: read » + racines : Read,Glob,Grep, cwd sur la première racine, --add-dir pour les suivantes', () => {
  const appel = preparerTacheNiveau1({
    prompt: 'q', profile: 'execution', space: 'projet-x', specialist: 'architecte',
    contexte: { outilsFiche: 'read', racines: ['/tmp/a', '/tmp/b', '/tmp/c'] },
  });
  assert.strictEqual(appel.lectureAccordee, true);
  assert.strictEqual(valeurArg(appel.args, '--tools'), 'Read,Glob,Grep');
  assert.strictEqual(appel.cwd, '/tmp/a');
  const ajouts = appel.args.filter((a, i) => appel.args[i - 1] === '--add-dir');
  assert.deepStrictEqual(ajouts, ['/tmp/b', '/tmp/c']);
});

test('aucun appel de spécialiste n\'accorde jamais d\'écriture, de Bash ni de MCP', () => {
  for (const contexte of [
    { outilsFiche: 'read', racines: ['/tmp/a'] },
    { outilsFiche: 'none', racines: [] },
  ]) {
    const appel = preparerTacheNiveau1({ prompt: 'q', profile: 'execution', space: 'x', specialist: 's', contexte });
    const outils = valeurArg(appel.args, '--tools');
    for (const interdit of ['Write', 'Edit', 'Bash', 'Agent', 'NotebookEdit', 'WebFetch']) {
      assert.ok(!outils.includes(interdit), `${interdit} ne doit jamais être accordé`);
    }
    assert.ok(appel.args.includes('--strict-mcp-config'));
    assert.ok(appel.args.includes('--disable-slash-commands'));
  }
});

test('le texte de la charte sur les outils reflète le --tools réellement accordé (D17)', () => {
  const avecLecture = preparerTacheNiveau1({
    prompt: 'q', profile: 'execution', space: 'projet-x', specialist: 'architecte',
    contexte: { outilsFiche: 'read', racines: ['/tmp/a'] },
  });
  assert.strictEqual(avecLecture.lectureAccordee, true);
  assert.doesNotMatch(avecLecture.charte, /aucun outil/, 'contredirait le --tools Read,Glob,Grep réellement transmis');
  assert.match(avecLecture.charte, /Read, Glob et Grep/);

  const sansLecture = preparerTacheNiveau1({
    prompt: 'q', profile: 'execution', space: 'projet-x', specialist: 'strategiste-produit',
    contexte: { outilsFiche: 'none', racines: [] },
  });
  assert.strictEqual(sansLecture.lectureAccordee, false);
  assert.match(sansLecture.charte, /aucun outil/);
});

test('preparerTacheNiveau1 injecte le contexte de l\'espace dans le prompt système', () => {
  const appel = preparerTacheNiveau1({
    prompt: 'q', profile: 'execution', space: 'projet-x', specialist: 'architecte',
    contexte: { fiche: 'FICHE', memoire: 'MEMOIRE', digest: 'DIGEST', decisions: 'DECISIONS', outilsFiche: 'none', racines: [] },
  });
  for (const attendu of ['FICHE', 'MEMOIRE', 'DIGEST', 'DECISIONS']) {
    assert.match(appel.systeme, new RegExp(attendu));
  }
  assert.ok(appel.systeme.startsWith(appel.charte.trim()), 'la charte reste en tête du prompt système');
});

// --- Étape 2 : passe mémoire (D9) --------------------------------------

test('preparerPasseMemoire retombe sur le mode « neuf » quand le session_id manque', () => {
  const appel = preparerPasseMemoire({
    mode: 'resume', sessionId: null, resultMd: 'AVIS', space: 'projet-x', specialist: 'architecte',
  });
  assert.strictEqual(appel.mode, 'neuf', 'un --resume sans session_id serait un appel invalide');
  assert.ok(!appel.args.includes('--resume'));
  assert.match(valeurArg(appel.args, '-p'), /AVIS/, 'le repli passe le RESULT.md en entrée');
});

test('preparerPasseMemoire en mode « resume » ajoute --resume et --fork-session, sans recopier l\'avis', () => {
  const appel = preparerPasseMemoire({
    mode: 'resume', sessionId: 'sess-abc', resultMd: 'AVIS', space: 'projet-x', specialist: 'architecte',
  });
  assert.strictEqual(appel.mode, 'resume');
  assert.strictEqual(valeurArg(appel.args, '--resume'), 'sess-abc');
  assert.ok(appel.args.includes('--fork-session'), '--fork-session : la session de la tâche n\'est jamais polluée');
  assert.doesNotMatch(valeurArg(appel.args, '-p'), /AVIS/, 'inutile de repayer le contexte que --resume restaure');
});

test('le mode « neuf » passe la mémoire actuelle, ou dit explicitement qu\'il n\'y en a pas', () => {
  const avec = preparerPasseMemoire({
    mode: 'neuf', resultMd: 'AVIS', memoireActuelle: 'ANCIENNE-MEMOIRE', space: 'x', specialist: 's',
  });
  assert.match(valeurArg(avec.args, '-p'), /ANCIENNE-MEMOIRE/);
  const sans = preparerPasseMemoire({ mode: 'neuf', resultMd: 'AVIS', space: 'x', specialist: 's' });
  assert.match(valeurArg(sans.args, '-p'), /Aucune mémoire antérieure/);
});

test('la passe mémoire est un appel borné : un tour, aucun outil, budget serré', () => {
  const appel = preparerPasseMemoire({ mode: 'neuf', resultMd: 'AVIS', space: 'x', specialist: 's' });
  assert.strictEqual(valeurArg(appel.args, '--max-turns'), '1');
  assert.strictEqual(valeurArg(appel.args, '--tools'), '');
  assert.strictEqual(valeurArg(appel.args, '--output-format'), 'json');
  assert.ok(appel.budget <= 1, 'une passe mémoire ne doit jamais coûter le prix d\'un avis');
});

// --- Étape 2 : session cartographe (§13.1) -----------------------------

test('preparerDigest refuse de cartographier un espace sans racine', () => {
  assert.throws(() => preparerDigest({ racines: [] }), /aucune racine déclarée/);
});

test('preparerDigest est un appel de lecture seule, borné, avec cwd sur la première racine', () => {
  const appel = preparerDigest({ racines: ['/tmp/a', '/tmp/b'] });
  assert.strictEqual(valeurArg(appel.args, '--tools'), 'Read,Glob,Grep');
  assert.strictEqual(appel.cwd, '/tmp/a');
  assert.ok(appel.args.includes('--add-dir'));
  assert.strictEqual(appel.profil, 'execution', 'cartographier n\'est pas concevoir');
  assert.ok(appel.budget <= 5 && appel.budget > 0);
  assert.match(valeurArg(appel.args, '-p'), /2000 tokens maximum/);
  assert.match(valeurArg(appel.args, '-p'), /n'invente aucun fichier/);
});

test('preparerDigest respecte un budget explicite, borné par clamp', () => {
  assert.strictEqual(preparerDigest({ racines: ['/tmp/a'], maxBudgetUsd: 0.5 }).budget, 0.5);
  assert.strictEqual(preparerDigest({ racines: ['/tmp/a'], maxBudgetUsd: 99 }).budget, 5, 'plafonné');
});
