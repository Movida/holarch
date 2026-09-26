'use strict';
/**
 * budget-watch.test.js — chantier 16, §18.1 (docs/IMPLEMENTATION.md). Module autonome, testé depuis
 * ce paquet (`require('../hooks/budget-watch.js')`, chemin identique une fois promu sous
 * `framework/hooks/`). Transcriptions fabriquées en répertoire temporaire, aucun réseau.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const budgetWatch = require(path.join(__dirname, '..', 'hooks', 'budget-watch.js'));

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-watch-'));
}

function ecrireTranscript(dir, nomRelatif, contenu) {
  const p = path.join(dir, nomRelatif);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contenu);
  return p;
}

function ligneAssistant(id, modele, usage) {
  return JSON.stringify({ type: 'assistant', message: { id, model: modele, usage } });
}

// -- lireRappel / estimerCout / decider : petites vérifications directes -------------------------------

test('lireRappel : dernier rappel USD budget du texte, ratio dépensé/plafond', () => {
  const texte = `bruit\nUSD budget: $1.00/$8; $7.00 remaining\nautre bruit\nUSD budget: $2.00/$8; $6.00 remaining\n`;
  const r = budgetWatch.lireRappel(texte);
  assert.equal(r.depense, 2);
  assert.equal(r.plafond, 8);
  assert.equal(r.ratio, 0.25);
  assert.equal(budgetWatch.lireRappel('rien ici'), null);
});

// -- (1) 79 % : rien -------------------------------------------------------------------------------

test('79 % du plafond : rien (sous la réserve)', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const transcriptPath = ecrireTranscript(dir, 's1.jsonl', 'USD budget: $6.32/$8; $1.68 remaining\n');
  const r = budgetWatch.budgetWatch({
    input: { transcript_path: transcriptPath, session_id: 's1' },
    root, instance: 'x', env: { HOLARCH_BUDGET_USD: '8' },
  });
  assert.equal(r.note, null);
  assert.ok(r.etat, 'un état est tout de même persisté (source cli)');
  assert.equal(r.etat.source, 'cli');
  assert.ok(Math.abs(r.etat.ratio - 0.79) < 1e-9);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (2) 81 % : ordre, une fois --------------------------------------------------------------------

test('81 % du plafond : ordre d\'hiberner, une seule fois', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const transcriptPath = ecrireTranscript(dir, 's2.jsonl', 'USD budget: $6.48/$8; $1.52 remaining\n');
  const input = { transcript_path: transcriptPath, session_id: 's2' };
  const env = { HOLARCH_BUDGET_USD: '8' };
  const premier = budgetWatch.budgetWatch({ input, root, instance: 'x', env });
  assert.match(premier.note, /budget de session/);
  const second = budgetWatch.budgetWatch({ input, root, instance: 'x', env });
  assert.equal(second.note, null, 'même palier : pas de répétition');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (3) 83 % après 81 % : pas de répétition dans le palier ----------------------------------------

test('83 % après un ordre à 81 % : pas de répétition dans le même palier de 5 %', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const transcriptPath = path.join(dir, 's3.jsonl');
  const env = { HOLARCH_BUDGET_USD: '8' };
  fs.writeFileSync(transcriptPath, 'USD budget: $6.48/$8; $1.52 remaining\n'); // 81 %
  const premier = budgetWatch.budgetWatch({ input: { transcript_path: transcriptPath, session_id: 's3' }, root, instance: 'x', env });
  assert.match(premier.note, /budget de session/);
  fs.writeFileSync(transcriptPath, 'USD budget: $6.64/$8; $1.36 remaining\n'); // 83 %, même palier de 5 % (16)
  const second = budgetWatch.budgetWatch({ input: { transcript_path: transcriptPath, session_id: 's3' }, root, instance: 'x', env });
  assert.equal(second.note, null, 'toujours le palier 16 (80-85 %) : pas de nouvel ordre');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (4) plafond remis à l'échelle par une passerelle : même décision ------------------------------

test('plafond remis à l\'échelle (passerelle) : même ratio, même décision que sans passerelle', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const env = { HOLARCH_BUDGET_USD: '8' }; // budget réel de la session, quel que soit le plafond du rappel CLI
  const tPasserelle = ecrireTranscript(dir, 's4a.jsonl', 'USD budget: $8.1/$10; $1.9 remaining\n'); // ratio 0.81, plafond remis à l'échelle (10)
  const tDirect = ecrireTranscript(dir, 's4b.jsonl', 'USD budget: $6.48/$8; $1.52 remaining\n'); // ratio 0.81, plafond réel (8)
  const rPasserelle = budgetWatch.budgetWatch({ input: { transcript_path: tPasserelle, session_id: 's4a' }, root, instance: 'x', env });
  const rDirect = budgetWatch.budgetWatch({ input: { transcript_path: tDirect, session_id: 's4b' }, root, instance: 'x', env });
  assert.match(rPasserelle.note, /budget de session/);
  assert.match(rDirect.note, /budget de session/);
  // Le plafond persisté est le budget réel de la session (HOLARCH_BUDGET_USD), pas le plafond remis à
  // l'échelle par la passerelle (10) : seul le ratio du rappel CLI compte.
  assert.equal(rPasserelle.etat.plafond, 8);
  assert.equal(rDirect.etat.plafond, 8);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (5) sous-agent qui franchit la réserve : consigne au sous-agent, une fois ----------------------

test('sous-agent qui franchit la réserve : consigne "rends ton rapport", une seule fois', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const sid = 'sid5';
  ecrireTranscript(dir, `${sid}.jsonl`, 'USD budget: $1.00/$8; $7.00 remaining\n'); // ratio principal 0.125
  const sousAgentPath = ecrireTranscript(
    dir, path.join(sid, 'subagents', 'sub1.jsonl'),
    `${ligneAssistant('m1', 'testmodel', { input_tokens: 0, output_tokens: 1000 })}\n`,
  );
  const env = {
    HOLARCH_BUDGET_USD: '8',
    HOLARCH_TARIF: JSON.stringify({ testmodel: { entree: 0, sortie: 5400, cache_lu: 0, cache_ecrit: 0 } }),
  };
  const input = { transcript_path: sousAgentPath, session_id: sid };
  const premier = budgetWatch.budgetWatch({ input, root, instance: 'x', env });
  assert.match(premier.note, /rends ton rapport/);
  const second = budgetWatch.budgetWatch({ input, root, instance: 'x', env });
  assert.equal(second.note, null, 'une seule consigne par transcription de sous-agent');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (6) sans rappel avec tarif : estimation, source "estime" ----------------------------------------

test('sans rappel CLI mais avec HOLARCH_TARIF : estimation, source "estime"', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const transcriptPath = ecrireTranscript(
    dir, 's6.jsonl',
    `${ligneAssistant('m1', 'sonnet-test', { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })}\n`,
  );
  const env = {
    HOLARCH_BUDGET_USD: '8',
    HOLARCH_TARIF: JSON.stringify({ 'sonnet-test': { entree: 3, sortie: 15, cache_lu: 0.3, cache_ecrit: 3.75 } }),
  };
  const r = budgetWatch.budgetWatch({ input: { transcript_path: transcriptPath, session_id: 's6' }, root, instance: 'x', env });
  assert.equal(r.etat.source, 'estime');
  const usdAttendu = (1000 * 3 + 200 * 15) / 1e6;
  assert.ok(Math.abs(r.etat.depense - usdAttendu) < 1e-9);
  assert.equal(r.note, null, 'coût estimé très faible : largement sous la réserve');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (7) sans rappel ni tarif : inerte ---------------------------------------------------------------

test('sans rappel CLI ni HOLARCH_TARIF : étape inerte, rien n\'est écrit', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const transcriptPath = ecrireTranscript(dir, 's7.jsonl', `${ligneAssistant('m1', 'sonnet-test', { input_tokens: 10, output_tokens: 5 })}\n`);
  const r = budgetWatch.budgetWatch({ input: { transcript_path: transcriptPath, session_id: 's7' }, root, instance: 'x', env: { HOLARCH_BUDGET_USD: '8' } });
  assert.equal(r.note, null);
  assert.equal(r.etat, null);
  assert.equal(fs.existsSync(budgetWatch.budgetLivePath(root, 'x')), false);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- Scénario HOLARCH_FAKE_CLAUDE : session close error_max_budget_usd -> Fin "coupée (fusible)" ----
// Ne tourne qu'après promotion (le paquet ne porte pas framework/bin/holarch-spawn.js à côté de ce
// test) : c'est mission/shared/concepteur/verificateurs/integration.js qui l'exerce, dans son clone.
const SPAWN_JS = path.join(__dirname, '..', 'bin', 'holarch-spawn.js');
const HAS_SPAWN = fs.existsSync(SPAWN_JS);

test(
  'HOLARCH_FAKE_CLAUDE : session close error_max_budget_usd -> Fin "coupée (fusible)" dans SESSIONS.md',
  { skip: HAS_SPAWN ? false : 'holarch-spawn.js absent à côté de ce test (paquet non appliqué)' },
  () => {
    const { execFileSync } = require('child_process');
    const { launchWithRelaunches } = require(SPAWN_JS);
    const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
    const SCENARIO = path.join(__dirname, 'scenarios', 'budget-epuise.json');

    const CONFIG = `# Configuration — mission : test-budget-watch
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | registre | sharded-files |

## Paramètres
| Paramètre | Valeur |
|---|---|
| profondeur_max | 2 |
| isolation | aucune |
| commit_par_session | non |
| relances_max | 2 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| execution | sonnet | medium |

## Fournisseurs
| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |
|---|---|---|---|---|
| anthropic | claude-code | — | — | — |

## Catalogue de modèles
| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent |
|---|---|---|---|---|---|---|
| sonnet | anthropic | claude-sonnet-5 | low…high | 3 / 15 | execution | — |
`;
    const fiche = '# x\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | — |\n| Statut | READY |\n'
      + '| Budget alloué / consommé | 3 / 0 |\n| Dépend de | — |\n| Profil | execution |\n| Livrables | — |\n'
      + '| Créée / Archivée | 2026-01-01T00:00:00Z / — |\n';

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-epuise-'));
    const w = (rel, contenu) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, contenu);
    };
    w('framework/KERNEL.md', '# KERNEL\n(stub de test — présence seule requise par findRoot)\n');
    w('framework/CONFIG.md', CONFIG);
    w('framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\n');
    w('framework/modules/registre/sharded-files.md', '# Module : sharded-files\n');
    w('mission/OBJECTIVE.md', 'Objectif de test.\n');
    w('mission/x/ROLE.md', '# ROLE\nTest.\n');
    w('mission/x/MEMORY.md', '# Mémoire\n(vide)\n');
    w('mission/x/INBOX.md', '# Inbox\n');
    w('mission/x/OUTBOX.md', '# Outbox\n');
    w('mission/x/JOURNAL.md', '# Journal\n');
    w('mission/x/STATUS.md', '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | — |\n');
    w('mission/registry/instances/x.md', fiche);
    w('mission/registry/ORG.md', '# Organisation\n- x (READY)\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });

    const cles = { HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO };
    const avant = {};
    for (const [k, v] of Object.entries(cles)) { avant[k] = process.env[k]; process.env[k] = v; }
    let sessions;
    try {
      sessions = launchWithRelaunches(root, 'x', {});
    } finally {
      for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    assert.ok(sessions.length >= 1 && sessions.length <= 3, `nombre de sessions inattendu : ${sessions.length}`);
    const txt = fs.readFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), 'utf8');
    const lignes = txt.split('\n').filter((l) => /^\| 2\d{3}-/.test(l));
    assert.ok(lignes.some((l) => /coupée \(fusible\)/.test(l)), `aucune ligne "coupée (fusible)" dans SESSIONS.md :\n${lignes.join('\n')}`);
    fs.rmSync(root, { recursive: true, force: true });
  },
);

// -- MSG-utilisateur-004, point A : paramètre absent ou vide lu comme absent, jamais comme 0 ----------------

test('lireNombre : vide ou blanc = absent, virgule décimale acceptée, texte refusé', () => {
  assert.equal(budgetWatch.lireNombre(''), undefined);
  assert.equal(budgetWatch.lireNombre('  '), undefined);
  assert.equal(budgetWatch.lireNombre(undefined), undefined);
  assert.equal(budgetWatch.lireNombre('16,5'), 16.5);
  assert.equal(budgetWatch.lireNombre('15'), 15);
  assert.equal(budgetWatch.lireNombre('abc'), undefined);
  assert.equal(budgetWatch.lireNombre('1,2,3'), undefined);
});

test('HOLARCH_SEUIL_BUDGET_PCT et HOLARCH_RESERVE_USD vides : défauts (80 %, 1,2 USD), aucune note en début de session', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const transcriptPath = ecrireTranscript(dir, 'sA.jsonl', 'USD budget: $0.08199699999999999/$15; $14.918003 remaining\n');
  const env = { HOLARCH_BUDGET_USD: '15', HOLARCH_SEUIL_BUDGET_PCT: '', HOLARCH_RESERVE_USD: '', HOLARCH_TARIF: '' };
  const r = budgetWatch.budgetWatch({ input: { transcript_path: transcriptPath, session_id: 'sA' }, root, instance: 'x', env });
  assert.equal(r.note, null, 'seuil vide lu comme 0 : ordre au palier 0');
  fs.writeFileSync(transcriptPath, 'USD budget: $12.3/$15; $2.7 remaining\n'); // 82 % : reste 2,7 ≤ 20 % × 15
  const r2 = budgetWatch.budgetWatch({ input: { transcript_path: transcriptPath, session_id: 'sA' }, root, instance: 'x', env });
  assert.match(r2.note, /budget de session/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// Bout en bout, après promotion seulement : environnement construit par le vrai prepareLaunch pour le CONFIG.md
// réel du dépôt, hook lancé par la commande PostToolUse déclarée dans framework/claude/instance-settings.json.
const HOOKS_JS = path.join(__dirname, '..', 'hooks', 'holarch-hooks.js');
const SETTINGS_JSON = path.join(__dirname, '..', 'claude', 'instance-settings.json');
const HAS_FRAMEWORK = HAS_SPAWN && fs.existsSync(HOOKS_JS) && fs.existsSync(SETTINGS_JSON)
  && fs.existsSync(path.join(__dirname, '..', 'CONFIG.md'));

test(
  'bout en bout : env du lanceur pour le CONFIG.md réel + hook déclaré → aucune note à 0,5 %, ordre à 82 %',
  { skip: HAS_FRAMEWORK ? false : 'framework promu absent à côté de ce test (paquet non appliqué)' },
  () => {
    const { spawnSync } = require('child_process');
    const { prepareLaunch } = require(SPAWN_JS);
    const settings = JSON.parse(fs.readFileSync(SETTINGS_JSON, 'utf8'));
    const commandes = (settings.hooks.PostToolUse || []).flatMap((h) => h.hooks.map((x) => x.command));
    const commande = commandes.find((c) => /holarch-hooks\.js"? context-watch/.test(c));
    assert.ok(commande, `aucun hook PostToolUse context-watch déclaré : ${commandes.join(' | ')}`);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-e2e-'));
    fs.symlinkSync(path.join(__dirname, '..'), path.join(root, 'framework'), 'dir');
    const w = (rel, contenu) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, contenu);
    };
    w('mission/OBJECTIVE.md', 'Objectif de test.\n');
    for (const f of ['ROLE', 'MEMORY', 'INBOX', 'OUTBOX', 'JOURNAL']) w(`mission/x/${f}.md`, `# ${f}\n`);
    w('mission/x/STATUS.md', '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | — |\n');
    const stderrOrig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true; // avertissements du dry-run : sans objet ici
    let launch;
    try {
      launch = prepareLaunch(root, 'x', { bootstrap: true, dryRun: true });
    } finally {
      process.stderr.write = stderrOrig;
    }
    for (const k of ['HOLARCH_SEUIL_BUDGET_PCT', 'HOLARCH_RESERVE_USD', 'HOLARCH_BUDGET_USD']) {
      assert.notEqual(launch.env[k], '', `${k} posé vide par le lanceur`);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
    const transcriptPath = ecrireTranscript(dir, 'sE.jsonl', 'USD budget: $0.08199699999999999/$15; $14.918003 remaining\n');
    const jouer = () => {
      const r = spawnSync('sh', ['-c', commande], {
        input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', transcript_path: transcriptPath, session_id: 'sE', cwd: root }),
        env: Object.assign({}, launch.env, { CLAUDE_PROJECT_DIR: root, HOLARCH_ROOT: root }),
        encoding: 'utf8',
        timeout: 20000,
      });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim() ? JSON.parse(r.stdout) : {};
    };
    const note = (sortie) => (sortie.hookSpecificOutput && sortie.hookSpecificOutput.additionalContext) || '';
    assert.doesNotMatch(note(jouer()), /budget de session/, 'note de budget à 0,5 % du plafond');
    fs.writeFileSync(transcriptPath, 'USD budget: $12.3/$15; $2.7 remaining\n');
    assert.match(note(jouer()), /budget de session/, 'hook déclaré mais budgetWatch non dispatché');
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  },
);

test(
  'revue n° 5 : HOLARCH_TARIF du lanceur (CONFIG.md réel) chiffre un sous-agent au tarif de son propre modèle',
  { skip: HAS_FRAMEWORK ? false : 'framework promu absent à côté de ce test (paquet non appliqué)' },
  () => {
    const { prepareLaunch } = require(SPAWN_JS);
    const catalogue = require(path.join(__dirname, '..', 'bin', 'catalogue.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-tarif-'));
    fs.symlinkSync(path.join(__dirname, '..'), path.join(root, 'framework'), 'dir');
    const w = (rel, contenu) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, contenu);
    };
    w('mission/OBJECTIVE.md', 'Objectif de test.\n');
    for (const f of ['ROLE', 'MEMORY', 'INBOX', 'OUTBOX', 'JOURNAL']) w(`mission/x/${f}.md`, `# ${f}\n`);
    w('mission/x/STATUS.md', '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | — |\n');
    const stderrOrig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    let launch;
    try { launch = prepareLaunch(root, 'x', { bootstrap: true, dryRun: true }); } finally { process.stderr.write = stderrOrig; }
    const cat = catalogue.parseCatalogue(fs.readFileSync(path.join(root, 'framework', 'CONFIG.md'), 'utf8'));
    const [idSession, session] = Object.entries(cat.modeles).find(([id, e]) => id === launch.meta.modele || e.modele_reel === launch.meta.modele);
    const [, autre] = Object.entries(cat.modeles).find(([id, e]) => id !== idSession && e.modele_reel && typeof e.cout_sortie === 'number'
      && e.cout_sortie !== session.cout_sortie);
    const ligne = JSON.stringify({ type: 'assistant', message: { id: 'sa1', model: autre.modele_reel, usage: { output_tokens: 1000000 } } });
    const cout = budgetWatch.estimerCout([ligne], JSON.parse(launch.env.HOLARCH_TARIF));
    assert.ok(Math.abs(cout - autre.cout_sortie) < 1e-9, `${autre.modele_reel} chiffré ${cout} USD/Mtok au lieu de ${autre.cout_sortie}`);
    fs.rmSync(root, { recursive: true, force: true });
  },
);

// -- MSG-utilisateur-004, points 2, 8, 9 ------------------------------------------------------------------

const TARIF_1USD = JSON.stringify({ defaut: { entree: 0, sortie: 1, cache_lu: 0, cache_ecrit: 0 } }); // 1 USD / Mtok sortie
/** `n` messages assistant distincts à 0,001 USD chacun (1000 tokens de sortie), rembourrés pour grossir le fichier. */
function lignesCout(n, prefixe) {
  let s = '';
  for (let i = 0; i < n; i += 1) {
    s += `${JSON.stringify({ type: 'assistant', message: { id: `${prefixe}${i}`, model: 'm', usage: { output_tokens: 1000 }, content: 'x'.repeat(500) } })}\n`;
  }
  return s;
}

test('point 2 : coût estimé sur toute la transcription (> 1 Mo), relu incrémentalement', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const t = ecrireTranscript(dir, 's2b.jsonl', lignesCout(3000, 'a'));
  assert.ok(fs.statSync(t).size > 1024 * 1024);
  const env = { HOLARCH_BUDGET_USD: '8', HOLARCH_TARIF: TARIF_1USD };
  const input = { transcript_path: t, session_id: 's2b' };
  const r1 = budgetWatch.budgetWatch({ input, root, instance: 'x', env });
  assert.ok(Math.abs(r1.etat.depense - 3) < 1e-6, `dépense ${r1.etat.depense} au lieu de 3`);
  assert.equal(r1.etat.cumul[t].offset, fs.statSync(t).size);
  fs.appendFileSync(t, lignesCout(1000, 'b') + JSON.stringify({ type: 'assistant', message: { id: 'b999', model: 'm', usage: { output_tokens: 1000 } } }) + '\n');
  const r2 = budgetWatch.budgetWatch({ input, root, instance: 'x', env });
  assert.ok(Math.abs(r2.etat.depense - 4) < 1e-6, `dépense ${r2.etat.depense} au lieu de 4 (doublon d'id compté ?)`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('points 2 et 8 : sous-agent — toute sa transcription, état principal conservé, base estimée persistée', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const env = { HOLARCH_BUDGET_USD: '8', HOLARCH_TARIF: TARIF_1USD };
  // (a) mode rappel : l'appel du sous-agent ne réécrit ni plafond, ni dépense, ni ratio, ni source.
  ecrireTranscript(dir, 'sa.jsonl', 'USD budget: $1.00/$8; $7.00 remaining\n');
  budgetWatch.budgetWatch({ input: { transcript_path: path.join(dir, 'sa.jsonl'), session_id: 'sa' }, root, instance: 'x', env });
  const sub = ecrireTranscript(dir, path.join('sa', 'subagents', 'agent-1.jsonl'), lignesCout(3000, 'c'));
  const ra = budgetWatch.budgetWatch({ input: { transcript_path: sub, session_id: 'sa' }, root, instance: 'x', env });
  assert.equal(ra.note, null, '0,125 + 3/8 = 0,5 : sous la réserve');
  const persiste = JSON.parse(fs.readFileSync(budgetWatch.budgetLivePath(root, 'x'), 'utf8'));
  assert.deepEqual([persiste.plafond, persiste.depense, persiste.source], [8, 1, 'cli']);
  assert.ok(Math.abs(persiste.cumul[sub].usd - 3) < 1e-6, 'sous-agent de plus d\'1 Mo sommé en entier');
  // (b) mode estimé : base = dernière dépense principale persistée (5 USD), pas 0.
  const root2 = tmpRoot();
  const tp = ecrireTranscript(dir, 'sb.jsonl', lignesCout(5000, 'd'));
  budgetWatch.budgetWatch({ input: { transcript_path: tp, session_id: 'sb' }, root: root2, instance: 'x', env });
  const sub2 = ecrireTranscript(dir, path.join('sb', 'subagents', 'agent-2.jsonl'), lignesCout(1500, 'e'));
  const rb = budgetWatch.budgetWatch({ input: { transcript_path: sub2, session_id: 'sb' }, root: root2, instance: 'x', env });
  assert.match(rb.note || '', /rends ton rapport/, '5 + 1,5 = 6,5 sur 8 : réserve (1,6) franchie');
  assert.ok(Math.abs(rb.etat.depense - 5) < 1e-6);
  for (const d of [root, root2, dir]) fs.rmSync(d, { recursive: true, force: true });
});

test('point 9 : faux rappel (autre plafond, dépense décroissante) ignoré, vrais rappels toujours suivis', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const t = path.join(dir, 's9.jsonl');
  const env = { HOLARCH_BUDGET_USD: '15' };
  const jouer = () => budgetWatch.budgetWatch({ input: { transcript_path: t, session_id: 's9' }, root, instance: 'x', env });
  fs.writeFileSync(t, 'USD budget: $1.00/$15; $14.00 remaining\nsortie de cat : USD budget: $7.6/$8; $0.4 remaining\n');
  const r1 = jouer();
  assert.equal(r1.note, null, 'fixture à 95 % d\'un autre plafond : ignorée');
  assert.equal(r1.etat.ordre_a, null);
  fs.appendFileSync(t, 'USD budget: $12.30/$15; $2.70 remaining\n');
  assert.match(jouer().note || '', /budget de session/, 'vrai rappel à 82 % : ordre (palier non sauté)');
  fs.appendFileSync(t, 'fixture : USD budget: $0.50/$15; $14.50 remaining\n');
  const r3 = jouer();
  assert.equal(r3.note, null);
  assert.ok(Math.abs(r3.etat.ratio - 0.82) < 1e-9, 'rappel à dépense décroissante ignoré');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- Revue n° 3 : un « USD budget » cité (TASK, cat) ne fixe plus le plafond de la session --------------------
test('revue n° 3 : plafond cité à 15 dans une TASK, budget 12 → les attachements budget_usd du CLI gouvernent', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const t = path.join(dir, 's3.jsonl');
  const env = { HOLARCH_BUDGET_USD: '12' };
  const jouer = () => budgetWatch.budgetWatch({ input: { transcript_path: t, session_id: 's3' }, root, instance: 'x', env });
  const citation = JSON.stringify({ type: 'user', message: { role: 'user', content: 'TASK : USD budget: $0.08199699999999999/$15; $14.918003 remaining' } });
  const attachement = (used) => JSON.stringify({ type: 'attachment', attachment: { type: 'budget_usd', used, total: 12, remaining: 12 - used } });
  fs.writeFileSync(t, `${citation}\n`);
  // Troisième revue n° 3, 80 : prise dans une phrase, la citation n'est plus un rappel, même seule visible.
  assert.equal(jouer().etat, null, 'citation seule : aucun rappel, aucun état');
  fs.appendFileSync(t, `${attachement(2)}\n`);
  const r2 = jouer();
  assert.equal(r2.etat.plafond_cli, 12, 'premier attachement : le plafond réel remplace le plafond cité');
  assert.ok(Math.abs(r2.etat.ratio - 2 / 12) < 1e-9);
  fs.appendFileSync(t, `${attachement(6)}\n${citation}\n`);
  assert.ok(Math.abs(jouer().etat.ratio - 0.5) < 1e-9, 'la citation relue après un attachement est ignorée');
  fs.appendFileSync(t, `${attachement(9.8)}\n`);
  assert.match(jouer().note || '', /budget de session/, 'à 9,8/12 (82 %) : ordre');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('seconde revue n° 3 : repli texte seul — une citation « $…/$15 » vue en premier n\'épingle plus le plafond', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const cas = (nom, budgetUsd, plafondReel) => {
    const t = path.join(dir, `${nom}.jsonl`);
    const env = { HOLARCH_BUDGET_USD: budgetUsd };
    const jouer = () => budgetWatch.budgetWatch({ input: { transcript_path: t, session_id: nom }, root, instance: nom, env });
    const rappel = (used) => `USD budget: $${used}/$${plafondReel}; $${plafondReel - used} remaining\n`;
    fs.writeFileSync(t, 'TASK : USD budget: $0.08199699999999999/$15; $14.918003 remaining\n');
    jouer();
    fs.appendFileSync(t, rappel(plafondReel * 2 / 12));
    const r2 = jouer();
    assert.equal(r2.etat.plafond_cli, plafondReel, `${nom} : premier vrai rappel, le plafond cité cède`);
    fs.appendFileSync(t, `${rappel(plafondReel * 6 / 12)}TASK : USD budget: $0.08199699999999999/$15; $14.918003 remaining\n`);
    assert.ok(Math.abs(jouer().etat.ratio - 0.5) < 1e-9, `${nom} : citation relue après les vrais rappels, ignorée`);
    fs.appendFileSync(t, rappel(plafondReel * 9.8 / 12));
    assert.match(jouer().note || '', /budget de session/, `${nom} : à 82 % du vrai plafond, ordre`);
  };
  cas('s3t', '12', 12);
  cas('s3p', '12', 30); // passerelle : le CLI voit un plafond remis à l'échelle, jamais 12
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- Revue n° 4 : sous-agents en parallèle comparés ensemble à la réserve ---------------------------------------
test('revue n° 4 : trois sous-agents à 0,5 USD par tour depuis $6/$15, réserve 3 → consigne dès que leur somme la franchit', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const env = { HOLARCH_BUDGET_USD: '15', HOLARCH_TARIF: TARIF_1USD, HOLARCH_RESERVE_USD: '3' };
  const principal = ecrireTranscript(dir, 's4.jsonl', 'USD budget: $6/$15; $9 remaining\n');
  budgetWatch.budgetWatch({ input: { transcript_path: principal, session_id: 's4' }, root, instance: 'x', env });
  const subs = [1, 2, 3].map((n) => ecrireTranscript(dir, path.join('s4', 'subagents', `agent-${n}.jsonl`), ''));
  const notes = [];
  for (let tour = 1; tour <= 5; tour += 1) {
    for (const [n, sub] of subs.entries()) {
      fs.appendFileSync(sub, lignesCout(500, `t${tour}a${n}-`));
      const r = budgetWatch.budgetWatch({ input: { transcript_path: sub, session_id: 's4' }, root, instance: 'x', env });
      if (r.note) notes.push(tour);
    }
  }
  assert.equal(notes[0] <= 4, true, `somme 6 + 3 × 0,5 × 4 = 12 (reste 3) au tour 4 : consigne attendue, reçue aux tours ${notes}`);
  assert.equal(notes.length, 3, 'une consigne par sous-agent, pas plus');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- Revue n° 36 : la réserve franchie par un sous-agent se lit dans .budget.json -------------------------------------
test('revue n° 36 : $10.50/$15 puis sous-agent à 2,5 USD → .budget.json porte ratio_total et depense_totale, conservés', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const sid = 'sid36';
  const principal = ecrireTranscript(dir, `${sid}.jsonl`, 'USD budget: $10.50/$15; $4.50 remaining\n');
  const sub = ecrireTranscript(dir, path.join(sid, 'subagents', 'sub1.jsonl'),
    `${ligneAssistant('m1', 'testmodel', { input_tokens: 0, output_tokens: 1000 })}\n`);
  const env = { HOLARCH_BUDGET_USD: '15', HOLARCH_TARIF: JSON.stringify({ testmodel: { entree: 0, sortie: 2500, cache_lu: 0, cache_ecrit: 0 } }) };
  try {
    budgetWatch.budgetWatch({ input: { transcript_path: principal, session_id: sid }, root, instance: 'x', env });
    const r = budgetWatch.budgetWatch({ input: { transcript_path: sub, session_id: sid }, root, instance: 'x', env });
    assert.match(r.note || '', /rends ton rapport/);
    const lu = () => JSON.parse(fs.readFileSync(budgetWatch.budgetLivePath(root, 'x'), 'utf8'));
    assert.ok(Math.abs(lu().ratio_total - 13 / 15) < 1e-6, 'ratio_total = (10,5 + 2,5) / 15');
    assert.ok(Math.abs(lu().depense_totale - 13) < 1e-6);
    assert.ok(Math.abs(lu().ratio - 0.7) < 1e-6, 'ratio principal inchangé');
    budgetWatch.budgetWatch({ input: { transcript_path: principal, session_id: sid }, root, instance: 'x', env });
    assert.ok(Math.abs(lu().ratio_total - 13 / 15) < 1e-6, 'un appel principal au même rappel ne fait pas redescendre le total');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// -- Troisième revue n° 3 (partiel) et n° 80 : une citation ne donne pas d'ordre et ne masque pas les vrais rappels ------
test('troisième revue n° 3, 80 : repli texte seul — scénarios bw-n3 du relecteur (passerelle + grep, citation haute avant, relue au milieu)', () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-transcript-'));
  const rap = (u, p) => `USD budget: $${u}/$${p}; $${+(p - u).toFixed(6)} remaining\n`;
  const scenario = (nom, etapes) => {
    const t = path.join(dir, `${nom}.jsonl`);
    fs.writeFileSync(t, '');
    return etapes.map(([etiquette, texte]) => {
      fs.appendFileSync(t, texte);
      const r = budgetWatch.budgetWatch({ input: { transcript_path: t, session_id: nom }, root, instance: nom, env: { HOLARCH_BUDGET_USD: '12' } });
      return `${etiquette}:${r.note ? 'ORDRE' : '-'}:${r.etat ? r.etat.ratio.toFixed(3) : 'null'}`;
    }).join(' ');
  };
  const cit15 = 'TASK : USD budget: $0.08199699999999999/$15; $14.918003 remaining\n';
  const grep5 = [1, 2, 3, 4, 5].map((i) => `docs/f${i}.md: « ${rap(0.082, 15).trim()} »\n`).join('');
  const cit12haut = 'TASK : ta session a été coupée à « USD budget: $11.9/$12; $0.1 remaining »\n';
  try {
    // n° 3 : passerelle (vrais rappels /30 pour un budget 12), six citations /15 → ordre à 82 % du vrai plafond.
    assert.equal(scenario('B', [['cit', cit15], ['grep', grep5], ['r2', rap(5, 30)], ['r6', rap(15, 30)], ['r9.8', rap(24.5, 30)]]),
      'cit:-:null grep:-:null r2:-:0.167 r6:-:0.500 r9.8:ORDRE:0.817');
    // n° 80 : citation haute au même plafond, avant les vrais rappels → ni faux ordre, ni vrais rappels masqués.
    assert.equal(scenario('C', [['cit', cit12haut], ['2', rap(2, 12)], ['6', rap(6, 12)], ['9.8', rap(9.8, 12)]]),
      'cit:-:null 2:-:0.167 6:-:0.500 9.8:ORDRE:0.817');
    // n° 80 : citation haute relue au milieu (cat INBOX) → ignorée, l'ordre vient du vrai 9,8.
    assert.equal(scenario('D', [['2', rap(2, 12)], ['cat', cit12haut], ['6', rap(6, 12)], ['9.8', rap(9.8, 12)]]),
      '2:-:0.167 cat:-:0.167 6:-:0.500 9.8:ORDRE:0.817');
    // Forme JSONL : un rappel seul sur sa ligne dans une chaîne (`\n` échappé, balise) compte ; la citation voisine non.
    const ligne = (texte) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: texte } })}\n`;
    assert.equal(scenario('J', [
      ['cit', ligne('TASK : ta session a été coupée à « USD budget: $11.9/$12; $0.1 remaining »')],
      ['r2', ligne('<system-reminder>\nUSD budget: $2/$12; $10 remaining\n</system-reminder>')],
      ['r9.8', ligne('résultat\n<system-reminder>USD budget: $9.8/$12; $2.2 remaining</system-reminder>')],
    ]), 'cit:-:null r2:-:0.167 r9.8:ORDRE:0.817');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
