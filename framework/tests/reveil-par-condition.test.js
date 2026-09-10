'use strict';
// Tests du chantier 2 « réveil par condition, lanceur détachable, arrêt propre » (docs/IMPLEMENTATION.md
// §3.8, dix points ; le 11e, « changement de régime », est couvert par holarch.test.js). Portés depuis
// le livrable de la mission holarch-fondations à la promotion (2026-09-10) ; T-C4.2 y gagne les deux
// assertions SESSIONS.md du §3.8, et un test couvre l'avertissement de synthèse du §3.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CAND = path.resolve(__dirname, '..');
const launcher = require(path.join(CAND, 'bin', 'holarch-spawn.js'));
const reveil = require(path.join(CAND, 'bin', 'reveil.js'));
const HOOKS = path.join(CAND, 'hooks', 'holarch-hooks.js');
const FAKE_CLAUDE = path.join(CAND, 'tests', 'fake-claude.js');

const CONFIG = `# Configuration — mission : test-c2
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | monolithic |
| 4 | recursion | max-depth |
| 5 | registre | sharded-files |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 3 |
| profondeur_max | 2 |
| permission_mode | acceptEdits |
| format_rapport_final | simple |
| max_tours_par_session | 42 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | xhigh |
| execution | sonnet | low |

## Valeurs organisationnelles
- Faire simple.
`;

function status(etat, note = '', reveilTxt = '—') {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-02T00:00:00Z |\n| Posé par | soi |\n| Note | ${note} |\n| Réveil | ${reveilTxt} |\n`;
}
function fiche(chemin, { alloue = 2, consomme = 0 } = {}) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | x |\n| Statut | READY |\n| Budget alloué / consommé | ${alloue} / ${consomme} |\n| Dépend de | — |\n| Livrables | — |\n| Créée / Archivée | 2026-09-10T00:00:00Z / — |\n`;
}

/** Racine de mission jetable, minimale : juste assez pour prepareLaunch/buildSystemPrompt (les fichiers
 *  de module référencés par CONFIG.md n'ont pas besoin d'exister — buildSystemPrompt les marque
 *  INTROUVABLE sans lever d'erreur). */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-c2-'));
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  w('framework/KERNEL.md', '# KERNEL de test\n');
  w('framework/CONFIG.md', CONFIG);
  w('framework/claude/instance-settings.json', '{}');
  w('mission/concepteur/ROLE.md', '# Rôle\n');
  w('mission/concepteur/MEMORY.md', '# Mémoire\n');
  w('mission/concepteur/INBOX.md', '# Boîte\n');
  w('mission/concepteur/JOURNAL.md', '# Journal\n');
  w('mission/concepteur/STATUS.md', status('WORKING'));
  w('mission/registry/instances/concepteur.md', fiche('concepteur', { alloue: 3 }));
  w('mission/registry/PROGRESS.md', '# Avancement\n');
  return root;
}

function runHook(event, input, env) {
  const r = spawnSync('node', [HOOKS, event], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, env) });
  assert.equal(r.status, 0, `hook ${event} exit ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout || '{}');
}

function waitFor(pred, { timeoutMs = 15000, stepMs = 30 } = {}) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function tick() {
      let v;
      try { v = pred(); } catch (e) { return reject(e); }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor : délai dépassé'));
      setTimeout(tick, stepMs);
    })();
  });
}

const FAKE_RESULT_OK = { type: 'result', subtype: 'success', session_id: 'fake', total_cost_usd: 0.001, num_turns: 1, usage: {}, is_error: false };

// Lecture tolérante à la course d'écriture : un fichier de tâche peut être lu à mi-écriture
// (vide ou tronqué) pendant qu'un processus détaché le produit ; on retente au tick suivant
// plutôt que de faire échouer waitFor sur une erreur transitoire.
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function withFakeClaude(scenario, fn) {
  const scenarioPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-c2-scn-')), 'scenario.json');
  fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
  const saved = { fake: process.env.HOLARCH_FAKE_CLAUDE, scn: process.env.HOLARCH_FAKE_SCENARIO };
  process.env.HOLARCH_FAKE_CLAUDE = FAKE_CLAUDE;
  process.env.HOLARCH_FAKE_SCENARIO = scenarioPath;
  return Promise.resolve().then(fn).finally(() => {
    process.env.HOLARCH_FAKE_CLAUDE = saved.fake;
    process.env.HOLARCH_FAKE_SCENARIO = saved.scn;
  });
}

// --- 1. parseReveil / formatReveil : forme canonique, rejets --------------------------------------
test('reveil : parseReveil/formatReveil forme canonique, rejets', () => {
  const cases = [
    ['message:TASK', { op: 'terme', kind: 'message', arg: 'TASK' }],
    ['enfant:enfant:DELIVERED', { op: 'terme', kind: 'enfant', arg: 'enfant', arg2: 'DELIVERED' }],
    ['enfants:DELIVERED', { op: 'terme', kind: 'enfants', arg: 'DELIVERED' }],
    ['fichier:mission/x', { op: 'terme', kind: 'fichier', arg: 'mission/x' }],
    ['date:2026-01-01T00:00:00Z', { op: 'terme', kind: 'date', arg: '2026-01-01T00:00:00Z' }],
  ];
  for (const [txt, expected] of cases) {
    const ast = reveil.parseReveil(txt);
    assert.deepEqual(ast, expected, txt);
    assert.equal(reveil.formatReveil(ast), txt);
  }
  const tous = reveil.parseReveil('tous( message:TASK , enfant:a:DELIVERED )');
  assert.equal(reveil.formatReveil(tous), 'tous(message:TASK,enfant:a:DELIVERED)');
  const lun = reveil.parseReveil('lun(fichier:a,fichier:b)');
  assert.equal(reveil.formatReveil(lun), 'lun(fichier:a,fichier:b)');
  assert.equal(reveil.parseReveil('—'), null);
  assert.equal(reveil.parseReveil('-'), null);
  assert.equal(reveil.parseReveil(''), null);
  assert.equal(reveil.parseReveil(null), null);
  assert.equal(reveil.parseReveil('message:INCONNU'), null);
  assert.equal(reveil.parseReveil('enfant:a:ETAT_INCONNU'), null);
  assert.equal(reveil.parseReveil('enfant::DELIVERED'), null);
  assert.equal(reveil.parseReveil('enfants:ETAT_INCONNU'), null);
  assert.equal(reveil.parseReveil('date:pas-une-date'), null);
  assert.equal(reveil.parseReveil("n'importe quoi"), null);
  assert.equal(reveil.parseReveil('tous()'), null);
  assert.equal(reveil.parseReveil('lun()'), null);
});

// --- 2. evalReveil : les 5 termes, tous()/lun(), enfants: sans enfant -----------------------------
test('reveil : evalReveil couvre les 5 termes, tous()/lun(), enfants: sans enfant', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-c2-eval-'));
  fs.mkdirSync(path.join(root, 'mission', 'p'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission', 'p', 'INBOX.md'),
    '---\nid: MSG-1\nfrom: a\nto: p\ntype: DELIVERABLE\nref: —\ndate: 2026-09-10T12:00:00Z\n---\ncorps\n');
  fs.writeFileSync(path.join(root, 'marker.txt'), 'x');
  const statuses = { 'p/a': { etat: 'DELIVERED', note: '' } };
  const ctx = {
    root, chemin: 'p', sinceIso: '2026-09-10T00:00:00Z', now: new Date('2026-09-10T13:00:00Z'),
    readStatus: (c) => statuses[c] || {},
    readInbox: (c) => fs.readFileSync(path.join(root, 'mission', c, 'INBOX.md'), 'utf8'),
  };
  assert.equal(reveil.evalReveil(reveil.parseReveil('message:DELIVERABLE'), ctx).satisfied, true);
  assert.equal(reveil.evalReveil(reveil.parseReveil('message:BLOCKER'), ctx).satisfied, false);
  assert.equal(reveil.evalReveil(reveil.parseReveil('enfant:a:DELIVERED'), ctx).satisfied, true);
  assert.equal(reveil.evalReveil(reveil.parseReveil('enfant:a:BLOCKED'), ctx).satisfied, false);
  assert.equal(reveil.evalReveil(reveil.parseReveil('fichier:marker.txt'), ctx).satisfied, true);
  assert.equal(reveil.evalReveil(reveil.parseReveil('fichier:absent.txt'), ctx).satisfied, false);
  assert.equal(reveil.evalReveil(reveil.parseReveil('date:2026-09-10T12:30:00Z'), ctx).satisfied, true);
  assert.equal(reveil.evalReveil(reveil.parseReveil('date:2026-09-10T14:00:00Z'), ctx).satisfied, false);
  const sansEnfant = reveil.evalReveil(reveil.parseReveil('enfants:DELIVERED'), ctx);
  assert.equal(sansEnfant.satisfied, false);
  assert.match(sansEnfant.details[0].pourquoi, /aucun enfant/);
  fs.mkdirSync(path.join(root, 'mission', 'p', 'a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission', 'p', 'a', 'STATUS.md'), 'x');
  assert.equal(reveil.evalReveil(reveil.parseReveil('enfants:DELIVERED'), ctx).satisfied, true);
  assert.equal(reveil.evalReveil(reveil.parseReveil('tous(fichier:marker.txt,message:BLOCKER)'), ctx).satisfied, false);
  assert.equal(reveil.evalReveil(reveil.parseReveil('lun(fichier:absent.txt,message:DELIVERABLE)'), ctx).satisfied, true);
  assert.equal(reveil.evalReveil(null, ctx).satisfied, false);
});

// --- 3. listWaiters : ignore workspace/graveyard/.holarch/registry/shared -------------------------
test('reveil : listWaiters parcourt mission/ en ignorant workspace, graveyard, registry, shared', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-c2-waiters-'));
  const w = (rel, etat, reveilTxt) => {
    const p = path.join(root, 'mission', rel, 'STATUS.md');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, status(etat, '', reveilTxt));
  };
  w('a', 'WAITING_CHILDREN', 'fichier:x');
  w('a/workspace/sous', 'WAITING_CHILDREN', 'fichier:x');
  w('a/graveyard/vieux', 'WAITING_CHILDREN', 'fichier:x');
  w('b', 'WORKING', '—');
  w('registry/instances/faux', 'WAITING_CHILDREN', 'fichier:x');
  w('shared/faux', 'WAITING_CHILDREN', 'fichier:x');
  const chemins = reveil.listWaiters(root).map((x) => x.chemin).sort();
  assert.deepEqual(chemins, ['a']);
});

// --- 4. isLive : pid vivant / pid mort (verrou nettoyé) --------------------------------------------
test('lanceur : isLive détecte un pid vivant, nettoie un verrou de pid mort', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-c2-live-'));
  const dir = path.join(root, 'mission', '.holarch', 'live');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'concepteur.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  assert.equal(launcher.isLive(root, 'concepteur'), true);
  const dead = spawnSync(process.execPath, ['-e', '']); // process déjà terminé : pid garanti mort
  const pDead = path.join(dir, 'concepteur-mort.json');
  fs.writeFileSync(pDead, JSON.stringify({ pid: dead.pid, startedAt: new Date().toISOString() }));
  assert.equal(launcher.isLive(root, 'concepteur-mort'), false);
  assert.equal(fs.existsSync(pDead), false);
  assert.equal(launcher.isLive(root, 'absent'), false);
});

// --- 5. wakeWaiters : réveille le bon parent (satisfait, pas live), pas les autres, écrit REVEILS.md
test('lanceur : wakeWaiters réveille le parent dont la condition est satisfaite, pas un autre, pas un parent live', async () => {
  const root = makeRoot();
  const w = (rel, etat, reveilTxt) => {
    const p = path.join(root, 'mission', rel, 'STATUS.md');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, status(etat, '', reveilTxt));
  };
  w('concepteur', 'WAITING_CHILDREN', 'enfant:enfant:DELIVERED');
  w('concepteur/enfant', 'DELIVERED', '—');
  w('autre', 'WAITING_CHILDREN', 'enfant:x:DELIVERED'); // condition fausse : x n'existe pas
  w('endormi', 'WAITING_CHILDREN', 'fichier:marker.txt'); // condition vraie mais instance déjà live
  fs.mkdirSync(path.join(root, 'mission', '.holarch', 'live'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission', '.holarch', 'live', 'endormi.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(root, 'marker.txt'), 'x');
  await withFakeClaude({ statusApres: 'DELIVERED', note: '', reveil: '—', commit: false, result: FAKE_RESULT_OK }, async () => {
    const reveilles = launcher.wakeWaiters(root, 'concepteur/enfant');
    assert.deepEqual(reveilles.map((r) => r.chemin), ['concepteur']);
    const tasksDir = path.join(root, 'mission', '.holarch', 'tasks');
    const [file] = fs.readdirSync(tasksDir);
    await waitFor(() => {
      const t = readJsonSafe(path.join(tasksDir, file));
      return t && t.state !== 'running';
    });
  });
  const reveils = fs.readFileSync(path.join(root, 'mission', 'registry', 'REVEILS.md'), 'utf8');
  assert.match(reveils, /\| concepteur \|/);
  assert.doesNotMatch(reveils, /\| autre \|/);
  assert.doesNotMatch(reveils, /\| endormi \|/);
  // ni « autre » ni « endormi » n'ont été (re)lancés : leur STATUS.md n'a pas bougé
  assert.match(fs.readFileSync(path.join(root, 'mission/autre/STATUS.md'), 'utf8'), /WAITING_CHILDREN/);
  assert.match(fs.readFileSync(path.join(root, 'mission/endormi/STATUS.md'), 'utf8'), /WAITING_CHILDREN/);
});

// --- 6. T-C4.2 sans LLM : détachement + réveil, mesure « 0 session parent vivante entre-temps » ---
test('T-C4.2 (HOLARCH_FAKE_CLAUDE) : détachement de l\'enfant puis réveil du parent, sans session parent vivante entre-temps', async () => {
  const root = makeRoot();
  const w = (rel, etat, reveilTxt) => {
    const dir = path.join(root, 'mission', rel);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'STATUS.md'), status(etat, '', reveilTxt));
    for (const f of ['ROLE.md', 'MEMORY.md', 'INBOX.md', 'JOURNAL.md']) {
      const fp = path.join(dir, f);
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, `# ${f}\n`);
    }
  };
  w('concepteur', 'WAITING_CHILDREN', 'enfant:enfant:DELIVERED');
  w('concepteur/enfant', 'READY', '—');
  const liveObserved = [];
  await withFakeClaude({ statusApres: 'DELIVERED', note: '', reveil: '—', commit: false, result: FAKE_RESULT_OK }, async () => {
    const { id: enfantId } = launcher.detachLaunch(root, 'concepteur/enfant', {});
    const tasksDir = path.join(root, 'mission', '.holarch', 'tasks');
    await waitFor(() => {
      liveObserved.push(launcher.isLive(root, 'concepteur'));
      const t = readJsonSafe(path.join(tasksDir, `${enfantId}.json`));
      return t && t.state !== 'running' ? t : false;
    });
    await waitFor(() => {
      const files = fs.readdirSync(tasksDir).filter((f) => f.startsWith('concepteur-') && !f.startsWith(`${enfantId}`) && !f.includes('-enfant-'));
      for (const f of files) {
        const t = readJsonSafe(path.join(tasksDir, f));
        if (t && t.state !== 'running') return t;
      }
      return false;
    });
  });
  assert.equal(liveObserved.some(Boolean), false,
    "mesure §7 point 3 : aucune session « concepteur » vivante entre le lancement de l'enfant et son réveil");
  assert.equal(launcher.isLive(root, 'concepteur'), false);
  assert.equal(launcher.isLive(root, 'concepteur/enfant'), false);
  assert.match(fs.readFileSync(path.join(root, 'mission/concepteur/enfant/STATUS.md'), 'utf8'), /\| État \| DELIVERED \|/);
  const reveils = fs.readFileSync(path.join(root, 'mission/registry/REVEILS.md'), 'utf8');
  assert.match(reveils, /\| concepteur \|/);
  assert.match(reveils, /concepteur\/enfant/);
  // §3.8 : SESSIONS.md fait foi — une session du parent postérieure à celle de l'enfant, aucune autre ligne entre les deux.
  const rows = fs.readFileSync(path.join(root, 'mission/registry/SESSIONS.md'), 'utf8').split('\n').filter((l) => /^\| \d{4}-/.test(l));
  const instances = rows.map((l) => l.split('|')[2].trim());
  const iEnfant = instances.lastIndexOf('concepteur/enfant');
  const iParent = instances.indexOf('concepteur', iEnfant + 1);
  assert.ok(iEnfant >= 0, 'SESSIONS.md porte la session de l\'enfant');
  assert.ok(iParent > iEnfant, 'SESSIONS.md porte une session du parent postérieure à celle de l\'enfant');
  assert.equal(iParent, iEnfant + 1, 'aucune autre ligne de SESSIONS.md entre la session de l\'enfant et celle du parent');
});

// --- 7. hook sleep-guard : bloque WAITING_CHILDREN/BLOCKED sans Réveil valide ----------------------
test('hook sleep-guard : bloque WAITING_CHILDREN/BLOCKED sans Réveil valide, laisse passer une condition valide', () => {
  const root = makeRoot();
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur', HOLARCH_COMMIT: 'non' };
  fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WAITING_CHILDREN', '', '—'));
  let out = runHook('sleep-guard', { session_id: `t7a-${Date.now()}`, cwd: root }, env);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /Réveil/);
  fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('BLOCKED', '', 'terme-invalide-!!'));
  out = runHook('sleep-guard', { session_id: `t7b-${Date.now()}`, cwd: root }, env);
  assert.equal(out.decision, 'block');
  fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WAITING_CHILDREN', '', 'tous(fichier:x,enfant:a:DELIVERED)'));
  out = runHook('sleep-guard', { session_id: `t7c-${Date.now()}`, cwd: root }, env);
  assert.deepEqual(out, {});
});

// --- 8. hook context-watch : fichier d'arrêt, une seule injection par session ----------------------
test("hook context-watch : le fichier d'arrêt déclenche l'ordre d'hiberner une seule fois par session", () => {
  const root = makeRoot();
  const stopDir = path.join(root, 'mission', '.holarch', 'stop');
  fs.mkdirSync(stopDir, { recursive: true });
  fs.writeFileSync(path.join(stopDir, 'concepteur'), `${new Date().toISOString()}\n`);
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' };
  const sid = `t8-${Date.now()}`;
  let out = runHook('context-watch', { session_id: sid, cwd: root }, env);
  assert.match(out.hookSpecificOutput.additionalContext, /arrêt demandé/);
  out = runHook('context-watch', { session_id: sid, cwd: root }, env);
  assert.deepEqual(out, {});
  out = runHook('context-watch', { session_id: `${sid}-autre`, cwd: root }, env);
  assert.match(out.hookSpecificOutput.additionalContext, /arrêt demandé/);
});

// --- 9. hook spawn-guard : --detach passe les mêmes règles ; --reveil/--arret toujours refusés -----
test('hook spawn-guard : --detach soumis aux mêmes règles ; --reveil et --arret toujours refusés', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'mission/concepteur/enfant'), { recursive: true });
  for (const f of ['ROLE.md', 'STATUS.md', 'MEMORY.md']) fs.writeFileSync(path.join(root, 'mission/concepteur/enfant', f), 'x');
  fs.writeFileSync(path.join(root, 'mission/registry/instances/concepteur-enfant.md'), fiche('concepteur/enfant'));
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' };
  const call = (command) => runHook('spawn-guard', { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command } }, env);
  const decision = (o) => (o.hookSpecificOutput || {}).permissionDecision;
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur/enfant --detach'), {});
  assert.equal(decision(call('node framework/bin/holarch-spawn.js --reveil')), 'deny');
  assert.equal(decision(call('node framework/bin/holarch-spawn.js --arret concepteur/enfant')), 'deny');
  assert.equal(decision(call('node framework/bin/holarch-spawn.js concepteur/enfant --detach --reveil')), 'deny');
});

// --- 10. hibernation volontaire (arrêt demandé) : pas de ré-incarnation, résumé dédié --------------
test('lanceur : hibernation volontaire (arrêt demandé) — pas de ré-incarnation, résumé dédié', () => {
  const root = makeRoot();
  let calls = 0;
  const runner = () => {
    calls += 1;
    fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WORKING', 'hibernation volontaire (arrêt demandé)'));
    return { res: Object.assign({}, FAKE_RESULT_OK, { session_id: `s${calls}` }), elapsedMs: 10 };
  };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur', {}, runner);
  assert.equal(calls, 1);
  const { text, code } = launcher.summarize(sessions[sessions.length - 1].launch, sessions);
  assert.equal(code, 0);
  assert.match(text, /arrêt propre demandé/);
});

// --- 11. §3.1 : une ligne Réveil invalide vaut « aucune condition » et le lanceur le dit -------------
test('lanceur : ligne Réveil invalide → avertissement dans la ligne de synthèse (§3.1) ; condition valide → rien', () => {
  const run = (reveilTxt) => {
    const root = makeRoot();
    const runner = () => {
      fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WAITING_CHILDREN', '', reveilTxt));
      return { res: Object.assign({}, FAKE_RESULT_OK), elapsedMs: 10 };
    };
    const sessions = launcher.launchWithRelaunches(root, 'concepteur', {}, runner);
    return launcher.summarize(sessions[sessions.length - 1].launch, sessions);
  };
  const invalide = run('terme-invalide-!!');
  assert.equal(invalide.code, 0);
  assert.match(invalide.text, /ligne Réveil de STATUS\.md invalide \(« terme-invalide-!! »\)/);
  assert.match(invalide.text, /aucune condition/);
  assert.doesNotMatch(run('enfant:enfant:DELIVERED').text, /Réveil de STATUS\.md invalide/);
});
