'use strict';
/**
 * Tests de daemon-core.js avec un faux `launch` (aucun sous-processus, aucun coût réel) — vérifie
 * la logique d'orchestration (file, concurrence, annulation, écriture RESULT.md/ledger) sans
 * dépendre du CLI Claude.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { creerCoeur, contexteNiveau1 } = require('./daemon-core');
const espaces = require('./spaces');
const ledger = require('./ledger');
const { fauxLanceur } = require('./fixtures');

function racineTemporaire() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-core-'));
  process.env.HOLARCH_HOME = d;
  return d;
}

function attendre(predicat, { timeoutMs = 3000, pasMs = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const debut = Date.now();
    const tick = () => {
      if (predicat()) { resolve(); return; }
      if (Date.now() - debut > timeoutMs) { reject(new Error('timeout')); return; }
      setTimeout(tick, pasMs);
    };
    tick();
  });
}

test('refinePrompt exige un prompt', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  await assert.rejects(() => coeur.refinePrompt({ prompt: '' }), /prompt requis/);
});

test('refinePrompt valide la sortie du triage et calcule un devis (chosen_by: router)', async () => {
  racineTemporaire();
  const coeur = creerCoeur({
    launch: fauxLanceur({
      triageSortie: {
        level: 1, specialists: ['generaliste'], profile: 'execution', complexity: 'basse',
        rationale: 'simple', questions: [], mission_draft: '', optimized_prompt: 'demande reformulée',
      },
    }),
    depotRacine: '/x',
  });
  const r = await coeur.refinePrompt({ prompt: 'question', space: 'default' });
  assert.strictEqual(r.level, 1);
  assert.strictEqual(r.optimized_prompt, 'demande reformulée');
  assert.strictEqual(r.chosen_by, 'router');
  assert.ok(r.estimate.cost_usd);
  assert.ok(r.ledger_id);
});

test('refinePrompt retombe proprement (chosen_by: fallback) si le triage ne renvoie rien d\'exploitable', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({ triageSortie: null }), depotRacine: '/x' });
  const r = await coeur.refinePrompt({ prompt: 'question' });
  assert.strictEqual(r.chosen_by, 'fallback');
  assert.strictEqual(r.level, 1);
  assert.deepStrictEqual(r.specialists, ['generaliste']);
});

test('submitTask refuse un niveau non implémenté à cette étape', () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  assert.throws(() => coeur.submitTask({ prompt: 'q', level: 3, profile: 'execution' }), /non implémenté/);
  assert.strictEqual(coeur.listTasks({}).length, 0, 'aucune tâche ne doit être créée pour un niveau refusé');
});

test('submitTask refuse review et parent_task (non implémentés à cette étape)', () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  assert.throws(() => coeur.submitTask({ prompt: 'q', level: 1, profile: 'execution', review: true }), /review/);
  assert.throws(() => coeur.submitTask({ prompt: 'q', level: 1, profile: 'execution', parent_task: 'abc' }), /parent_task/);
});

test('submitTask refuse un profil inconnu avant de créer quoi que ce soit', () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  assert.throws(() => coeur.submitTask({ prompt: 'q', level: 1, profile: 'stagiaire' }), /profil inconnu/);
  assert.strictEqual(coeur.listTasks({}).length, 0);
});

test('submitTask crée une tâche queued avec un devis, puis la termine à done avec RESULT.md et coût', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({ delaiMs: 15 }), depotRacine: '/x' });
  const { task_id: id, devis, state } = coeur.submitTask({ prompt: 'question', level: 1, profile: 'execution' });
  assert.strictEqual(state, 'queued');
  assert.ok(devis.cost_usd);

  await attendre(() => coeur.getTask(id).state === 'done');
  const t = coeur.getTask(id);
  assert.strictEqual(t.cost_usd, 0.02);
  assert.match(t.result_md, /réponse de test/);
  assert.match(t.result_md, /Coût réel/);
});

test('une tâche dont le lancement échoue passe à failed avec un message d\'erreur', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({ echoue: true, delaiMs: 10 }), depotRacine: '/x' });
  const { task_id: id } = coeur.submitTask({ prompt: 'question', level: 1, profile: 'execution' });
  await attendre(() => coeur.getTask(id).state === 'failed');
  assert.match(coeur.getTask(id).error, /pas de résultat/);
});

test('cancelTask sur une tâche en file d\'attente l\'annule sans jamais la lancer', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({ delaiMs: 100 }), depotRacine: '/x', concurrenceMax: 1 });
  const { task_id: id1 } = coeur.submitTask({ prompt: 'occupe le seul slot', level: 1, profile: 'execution' });
  const { task_id: id2 } = coeur.submitTask({ prompt: 'restera en file', level: 1, profile: 'execution' });
  assert.strictEqual(coeur.getTask(id2).state, 'queued');
  coeur.cancelTask(id2);
  assert.strictEqual(coeur.getTask(id2).state, 'cancelled');
  // Laisser la tâche 1 se terminer proprement (pas de minuteur en fuite vers le test suivant, qui
  // change process.env.HOLARCH_HOME et ferait échouer l'écriture différée de son résultat).
  await attendre(() => coeur.getTask(id1).state === 'done');
});

test('cancelTask sur une tâche en cours tue le sous-processus et passe l\'état à cancelled', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({ delaiMs: 5000 }), depotRacine: '/x' });
  const { task_id: id } = coeur.submitTask({ prompt: 'longue tâche', level: 1, profile: 'execution' });
  await attendre(() => coeur.getTask(id).state === 'running');
  coeur.cancelTask(id);
  await attendre(() => coeur.getTask(id).state === 'cancelled', { timeoutMs: 2000 });
});

test('concurrence_max borne le nombre de tâches réellement en cours simultanément', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({ delaiMs: 60 }), depotRacine: '/x', concurrenceMax: 1 });
  const ids = [
    coeur.submitTask({ prompt: 'a', level: 1, profile: 'execution' }).task_id,
    coeur.submitTask({ prompt: 'b', level: 1, profile: 'execution' }).task_id,
    coeur.submitTask({ prompt: 'c', level: 1, profile: 'execution' }).task_id,
  ];
  assert.strictEqual(coeur._enCours.size, 1, 'une seule tâche démarrée immédiatement');
  assert.strictEqual(coeur._enAttente.length, 2, 'les deux autres attendent leur tour');
  await Promise.all(ids.map((id) => attendre(() => coeur.getTask(id).state === 'done', { timeoutMs: 3000 })));
});

test('getTask échoue explicitement sur une tâche inexistante', () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  assert.throws(() => coeur.getTask('inexistante'), /introuvable/);
});

test('listTasks filtre par espace', () => {
  racineTemporaire();
  // Étape 2 : un espace non déclaré est refusé (SPEC.md §9 — un espace accorde un droit de
  // lecture, il se déclare en CLI). Les tests le déclarent donc explicitement ; des racines vides
  // sont permises en interne (seul `holarch space add` en exige au moins une).
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  espaces.creerEspace({ nom: 'projet-y', racines: [] });
  const coeur = creerCoeur({ launch: fauxLanceur({ delaiMs: 5000 }), depotRacine: '/x', concurrenceMax: 5 });
  coeur.submitTask({ prompt: 'a', level: 1, profile: 'execution', space: 'projet-x' });
  coeur.submitTask({ prompt: 'b', level: 1, profile: 'execution', space: 'projet-y' });
  assert.strictEqual(coeur.listTasks({ space: 'projet-x' }).length, 1);
  for (const t of coeur.listTasks({})) coeur.cancelTask(t.id);
});

// =======================================================================
// Étape 2 — espaces, catalogue, contexte injecté, mémoire, notation, digest
// =======================================================================

/** Attend qu'une tâche atteigne un état terminal, puis la renvoie. */
async function attendreEtat(coeur, id, etat) {
  await attendre(() => coeur.getTask(id).state === etat);
  return coeur.getTask(id);
}

test('submitTask refuse un espace non déclaré : un espace se déclare en CLI, jamais depuis MCP (§9)', () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  assert.throws(
    () => coeur.submitTask({ prompt: 'q', level: 1, profile: 'execution', space: 'jamais-declare' }),
    /espace inconnu.*holarch space add/s,
  );
  assert.strictEqual(coeur.listTasks({}).length, 0);
});

test('l\'espace « default » reste auto-créé : rien ne casse pour qui n\'en déclare jamais', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  const r = coeur.submitTask({ prompt: 'q', level: 1, profile: 'execution' });
  assert.ok(r.task_id);
  assert.strictEqual(coeur.getTask(r.task_id).space, 'default');
  assert.ok(espaces.existe('default'));
  // Laisser la tâche se terminer : sinon son écriture différée de RESULT.md retombe sur le
  // HOLARCH_HOME du test suivant (même précaution qu'au test de cancelTask ci-dessus).
  await attendreEtat(coeur, r.task_id, 'done');
});

test('un spécialiste hors catalogue retombe sur generaliste et le signale (§8)', () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({ delaiMs: 5000 }), depotRacine: '/x' });
  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', specialists: ['expert-en-licornes'],
  });
  assert.strictEqual(r.specialist, 'generaliste', 'la demande aboutit plutôt que d\'échouer');
  assert.strictEqual(r.specialist_fallback, 'expert-en-licornes', 'le repli est signalé, pas silencieux');
  coeur.cancelTask(r.task_id);
});

test('un spécialiste du catalogue est routé tel quel, sans repli', () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({ delaiMs: 5000 }), depotRacine: '/x' });
  const r = coeur.submitTask({ prompt: 'q', level: 1, profile: 'execution', specialists: ['architecte-logiciel'] });
  assert.strictEqual(r.specialist, 'architecte-logiciel');
  assert.strictEqual(r.specialist_fallback, null);
  coeur.cancelTask(r.task_id);
});

test('le contexte de l\'espace (fiche, mémoire, digest, décisions, racines) arrive dans l\'appel niveau 1', async () => {
  racineTemporaire();
  const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-racine-')));
  espaces.creerEspace({ nom: 'projet-x', racines: [racine] });
  espaces.ecrireMemoire('projet-x', 'architecte-logiciel', 'MA-MEMOIRE-DE-PROJET-X');
  espaces.ecrireDigest('projet-x', { corps: 'LA-CARTE-DU-DEPOT', commit: null });
  espaces.ajouterDecision('projet-x', { taskId: 't-0', verdict: 'good', note: 'UNE-DECISION-ANTERIEURE' });

  const appels = [];
  const coeur = creerCoeur({ launch: fauxLanceur({ appels }), depotRacine: '/x' });
  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', space: 'projet-x', specialists: ['architecte-logiciel'],
  });
  await attendreEtat(coeur, r.task_id, 'done');

  const appel = appels.find((a) => a.nom === 'niveau1');
  assert.ok(appel, 'un appel de niveau 1 a bien été préparé');
  assert.strictEqual(appel.space, 'projet-x');
  assert.strictEqual(appel.specialist, 'architecte-logiciel');
  assert.match(appel.contexte.fiche, /architecte-logiciel/i, 'la fiche du catalogue est injectée');
  assert.match(appel.contexte.memoire, /MA-MEMOIRE-DE-PROJET-X/);
  assert.match(appel.contexte.digest, /LA-CARTE-DU-DEPOT/);
  assert.match(appel.contexte.decisions, /UNE-DECISION-ANTERIEURE/);
  assert.deepStrictEqual(appel.contexte.racines, [racine]);
});

test('contexteNiveau1 sur un espace neuf ne renvoie que la fiche : chaque bloc est facultatif', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'neuf', racines: [] });
  const ctx = contexteNiveau1('neuf', 'architecte-logiciel');
  assert.ok(ctx.fiche);
  assert.strictEqual(ctx.memoire, null);
  assert.strictEqual(ctx.digest, null);
  assert.strictEqual(ctx.decisions, null);
  assert.deepStrictEqual(ctx.racines, []);
});

// --- Passe mémoire (D8/D9) ---------------------------------------------

test('la passe mémoire s\'exécute après une tâche réussie et réécrit MEMORY.md', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const coeur = creerCoeur({
    launch: fauxLanceur({ memoire: '## Ce que je sais du projet\n\nMEMOIRE-FRAICHE' }),
    depotRacine: '/x',
  });
  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', space: 'projet-x', specialists: ['architecte-logiciel'],
  });
  await attendreEtat(coeur, r.task_id, 'done');

  const res = await coeur.passeMemoire(r.task_id);
  assert.strictEqual(res.ok, true);
  assert.match(espaces.lireMemoire('projet-x', 'architecte-logiciel'), /MEMOIRE-FRAICHE/);
  assert.ok(coeur.getTask(r.task_id).memoryUpdatedAt, 'la tâche garde la trace de la mise à jour');
});

test('la passe mémoire est sautée si la tâche a échoué (D8 : on ne mémorise pas un échec)', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const coeur = creerCoeur({ launch: fauxLanceur({ echoue: true }), depotRacine: '/x' });
  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', space: 'projet-x', specialists: ['architecte-logiciel'],
  });
  await attendre(() => ['failed', 'done'].includes(coeur.getTask(r.task_id).state));
  assert.strictEqual(coeur.getTask(r.task_id).state, 'failed');

  const res = await coeur.passeMemoire(r.task_id);
  assert.match(res.saute, /non réussie/);
  assert.strictEqual(espaces.lireMemoire('projet-x', 'architecte-logiciel'), null);
});

// Le second cas que D9 veut exclure : le plafond atteint. Ce test existe pour prouver qu'il ne
// demande pas de garde propre — `--max-turns` épuisé fait répondre au CLI un résultat is_error,
// donc la tâche ne passe pas `done` et la garde unique de passeMemoire suffit.
test('la passe mémoire est sautée quand la tâche a épuisé son plafond de tours (is_error du CLI)', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const coeur = creerCoeur({
    launch: fauxLanceur({
      resultatPatch: { is_error: true, subtype: 'error_max_turns', result: 'plafond de tours atteint' },
      memoire: '## Ce que je sais du projet\n\nNE-DOIT-PAS-ETRE-ECRIT',
    }),
    depotRacine: '/x',
  });
  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', space: 'projet-x', specialists: ['architecte-logiciel'],
    max_turns: 1,
  });
  await attendre(() => ['failed', 'done'].includes(coeur.getTask(r.task_id).state));
  assert.strictEqual(coeur.getTask(r.task_id).state, 'failed', 'un plafond atteint est un échec, pas une réussite');

  const res = await coeur.passeMemoire(r.task_id);
  assert.match(res.saute, /non réussie/);
  assert.strictEqual(
    espaces.lireMemoire('projet-x', 'architecte-logiciel'), null,
    'aucune mémoire écrite : la passe ne s\'ajoute jamais à une tâche qui a dérapé',
  );
});

test('l\'échec de la passe mémoire n\'échoue jamais la tâche : l\'avis reste rendu', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const coeur = creerCoeur({ launch: fauxLanceur({ memoireEchoue: true }), depotRacine: '/x' });
  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', space: 'projet-x', specialists: ['architecte-logiciel'],
  });
  await attendreEtat(coeur, r.task_id, 'done');

  const res = await coeur.passeMemoire(r.task_id);
  assert.ok(res.saute, 'la passe mémoire renonce proprement');
  assert.strictEqual(coeur.getTask(r.task_id).state, 'done', 'la tâche reste réussie');
  assert.strictEqual(espaces.lireMemoire('projet-x', 'architecte-logiciel'), null, 'aucune mémoire douteuse écrite');
});

// --- rate_result et DECISIONS.md (§13.2) -------------------------------

test('rateResult écrit dans DECISIONS.md, patche la tâche et laisse une trace au ledger', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', space: 'projet-x', specialists: ['architecte-logiciel'],
  });
  await attendreEtat(coeur, r.task_id, 'done');

  const note = coeur.rateResult({
    task_id: r.task_id, verdict: 'good', note: 'utile', decisions: ['on part sur SQLite'],
  });
  assert.strictEqual(note.ok, true);
  assert.strictEqual(note.space, 'projet-x');
  assert.strictEqual(note.decisions_recorded, 1);

  const texte = espaces.lireDecisions('projet-x');
  assert.match(texte, /verdict good/);
  assert.match(texte, /- note : utile/);
  assert.match(texte, /- on part sur SQLite/);
  assert.match(texte, /- spécialiste : architecte-logiciel/);
  assert.strictEqual(coeur.getTask(r.task_id).verdict, 'good');
  assert.ok(coeur.getTask(r.task_id).ratedAt);
  assert.ok(ledger.lireLignes().some((l) => l.exit === 'note:good'));
});

test('rateResult refuse un verdict hors liste et une tâche inconnue', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', space: 'projet-x', specialists: ['architecte-logiciel'],
  });
  await attendreEtat(coeur, r.task_id, 'done');

  assert.throws(() => coeur.rateResult({ task_id: r.task_id, verdict: 'excellent' }), /verdict invalide/);
  assert.throws(() => coeur.rateResult({ task_id: 'inexistante', verdict: 'good' }), /tâche introuvable/);
  assert.strictEqual(espaces.lireDecisions('projet-x'), null, 'aucune décision écrite sur refus');
});

test('une décision se corrige en en ajoutant une qui la remplace, jamais en effaçant (§16)', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  const r = coeur.submitTask({ prompt: 'q', level: 1, profile: 'execution', space: 'projet-x' });
  await attendreEtat(coeur, r.task_id, 'done');

  coeur.rateResult({ task_id: r.task_id, verdict: 'good', note: 'premier avis' });
  coeur.rateResult({ task_id: r.task_id, verdict: 'bad', note: 'je me ravise', supersedes: r.task_id });
  const texte = espaces.lireDecisions('projet-x');
  assert.match(texte, /premier avis/, 'la décision initiale reste lisible');
  assert.match(texte, /je me ravise/);
  assert.match(texte, /- supersedes : /);
  assert.strictEqual(coeur.getTask(r.task_id).verdict, 'bad', 'la tâche porte le dernier verdict');
});

// --- list_specialists (§9) ---------------------------------------------

test('listSpecialists sert les six fiches résumées, sans leur corps, avec le compte de tâches', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });

  const avant = coeur.listSpecialists({ space: 'projet-x' });
  assert.strictEqual(avant.space, 'projet-x');
  assert.strictEqual(avant.specialists.length, 6, 'les six fiches du catalogue');
  assert.deepStrictEqual(avant.catalogue_errors, [], 'aucune fiche cassée');
  for (const s of avant.specialists) {
    assert.ok(s.name && s.when_to_use && s.specialty, 'de quoi choisir');
    assert.ok(['none', 'read'].includes(s.tools));
    assert.strictEqual(s.tasks_done, 0);
    assert.ok(!('body' in s) && JSON.stringify(s).length < 2000, 'un résumé, pas une persona entière');
  }

  const r = coeur.submitTask({
    prompt: 'q', level: 1, profile: 'execution', space: 'projet-x', specialists: ['architecte-logiciel'],
  });
  await attendreEtat(coeur, r.task_id, 'done');
  const apres = coeur.listSpecialists({ space: 'projet-x' });
  assert.strictEqual(apres.specialists.find((s) => s.name === 'architecte-logiciel').tasks_done, 1);
  assert.strictEqual(apres.specialists.find((s) => s.name === 'generaliste').tasks_done, 0);
});

test('le compte de tâches de list_specialists est cloisonné par espace', async () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'a', racines: [] });
  espaces.creerEspace({ nom: 'b', racines: [] });
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  const r = coeur.submitTask({ prompt: 'q', level: 1, profile: 'execution', space: 'a', specialists: ['architecte-logiciel'] });
  await attendreEtat(coeur, r.task_id, 'done');

  assert.strictEqual(coeur.listSpecialists({ space: 'a' }).specialists.find((s) => s.name === 'architecte-logiciel').tasks_done, 1);
  assert.strictEqual(coeur.listSpecialists({ space: 'b' }).specialists.find((s) => s.name === 'architecte-logiciel').tasks_done, 0);
});

// --- Espaces et digest côté cœur (CLI uniquement) ----------------------

test('spaceAdd puis spaceList : l\'espace apparaît avec l\'état de son digest', () => {
  racineTemporaire();
  const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-racine-')));
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });

  const ajout = coeur.spaceAdd({ name: 'projet-x', roots: [racine], description: 'Le projet X.' });
  assert.strictEqual(ajout.ok, true);
  assert.deepStrictEqual(ajout.space.roots, [racine]);

  const liste = coeur.spaceList();
  const x = liste.find((e) => e.name === 'projet-x');
  assert.ok(x);
  assert.strictEqual(x.tasks, 0);
  assert.strictEqual(x.digest.perime, true);
  assert.match(x.digest.motif, /aucun digest/);
  assert.ok(liste.some((e) => e.name === 'default'), 'spaceList garantit l\'existence de default');
});

test('spaceDigest régénère la carte quand elle manque, et écrit le commit de référence', async () => {
  racineTemporaire();
  const depot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-depot-')));
  const git = (...a) => execFileSync('git', ['-C', depot, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  git('config', 'user.email', 'test@holon.local');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(depot, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'un');

  const appels = [];
  const coeur = creerCoeur({
    launch: fauxLanceur({ appels, digest: '## À quoi sert ce dépôt\nCARTE-GENEREE' }),
    depotRacine: '/x',
  });
  coeur.spaceAdd({ name: 'projet-x', roots: [depot] });

  const premier = await coeur.spaceDigest({ name: 'projet-x' });
  assert.strictEqual(premier.regenere, true);
  assert.match(espaces.lireDigest('projet-x'), /CARTE-GENEREE/);
  assert.strictEqual(espaces.metaDigest('projet-x').commit, espaces.headDepot('projet-x'));
  assert.strictEqual(appels.filter((a) => a.nom === 'digest').length, 1);
  assert.strictEqual(appels.find((a) => a.nom === 'digest').cwd, depot, 'cartographie lancée dans la racine');

  // Deuxième appel : la carte est à jour, on ne repaye pas — sauf --force.
  const second = await coeur.spaceDigest({ name: 'projet-x' });
  assert.strictEqual(second.regenere, false);
  assert.match(second.motif, /à jour/);
  assert.strictEqual(appels.filter((a) => a.nom === 'digest').length, 1, 'aucun appel supplémentaire');

  const force = await coeur.spaceDigest({ name: 'projet-x', force: true });
  assert.strictEqual(force.regenere, true);
  assert.strictEqual(appels.filter((a) => a.nom === 'digest').length, 2);
});

test('spaceDigest refuse un espace inconnu, et remonte l\'échec de la cartographie', async () => {
  racineTemporaire();
  const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-racine-')));
  const coeur = creerCoeur({ launch: fauxLanceur({ digestEchoue: true }), depotRacine: '/x' });
  await assert.rejects(() => coeur.spaceDigest({ name: 'jamais-declare' }), /espace inconnu/);

  coeur.spaceAdd({ name: 'projet-x', roots: [racine] });
  await assert.rejects(() => coeur.spaceDigest({ name: 'projet-x' }), /rien produit d'exploitable/);
  assert.strictEqual(espaces.lireDigest('projet-x'), null, 'aucune carte douteuse écrite');
});

test('spaceDigest refuse de cartographier un espace sans racine', async () => {
  racineTemporaire();
  const coeur = creerCoeur({ launch: fauxLanceur({}), depotRacine: '/x' });
  coeur.spaceAdd({ name: 'sans-racine', roots: [] });
  await assert.rejects(() => coeur.spaceDigest({ name: 'sans-racine' }), /aucune racine déclarée/);
});
