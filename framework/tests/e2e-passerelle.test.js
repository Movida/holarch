'use strict';
// Chantier 11 (docs/IMPLEMENTATION.md §12.5) : test e2e OPT-IN de l'exécuteur \`passerelle\` — une
// vraie session d'un tour chez le fournisseur \`openrouter\` du catalogue du preset. Ignoré par
// défaut : sans \`HOLARCH_E2E_PASSERELLE=1\` ou sans les deux variables du fournisseur, aucun appel
// réseau n'est fait. Jamais en CI (.github/workflows/ inchangé) — un test qui dépense de l'argent
// réel et dépend d'un service tiers n'a rien à faire dans une passe automatique sur chaque push.
//
// Secrets : ce fichier ne doit JAMAIS afficher, comparer par égalité (qui les ferait apparaître dans
// un diff d'échec) ni committer la valeur de HOLARCH_FOURNISSEUR_OPENROUTER_URL / _JETON. Les
// vérifications d'absence de fuite se font par .includes(), jamais par assert.equal sur la valeur.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CIBLE = path.resolve(__dirname, '..');
const ROOT = path.resolve(CIBLE, '..');
const catalogue = require(path.join(CIBLE, 'bin', 'catalogue.js'));
const launcher = require(path.join(CIBLE, 'bin', 'holarch-spawn.js'));
const passerelle = require(path.join(CIBLE, 'bin', 'executeurs', 'passerelle.js'));

const URL_VAR = 'HOLARCH_FOURNISSEUR_OPENROUTER_URL';
const JETON_VAR = 'HOLARCH_FOURNISSEUR_OPENROUTER_JETON';
const OPT_IN = process.env.HOLARCH_E2E_PASSERELLE === '1'
  && !!process.env[URL_VAR] && !!process.env[JETON_VAR];

test('e2e passerelle : session minimale chez le fournisseur du catalogue (opt-in)', { skip: !OPT_IN && 'HOLARCH_E2E_PASSERELLE=1 et les deux variables du fournisseur openrouter sont requis' }, () => {
  const cfgTexte = require('fs').readFileSync(path.join(ROOT, 'framework', 'CONFIG.md'), 'utf8');
  const cat = catalogue.parseCatalogue(cfgTexte);
  const meta = launcher.enrichirMeta({ modele: 'sonnet@openrouter', effort: 'medium' }, cat, 'e2e-passerelle-test', {});
  assert.equal(meta.fournisseur, 'openrouter');
  const fournisseur = launcher.fournisseurPour(cat, meta, process.env);
  assert.ok(fournisseur, 'fournisseur openrouter introuvable dans le catalogue du preset');

  // cwd hors du dépôt, dans un répertoire jetable : constaté en réel (chantier 11) qu'un cwd pointé
  // sur la racine du dépôt fait charger à Claude Code, en plus de --settings, le .claude/settings.json
  // du projet (hooks tools/holarch-session/garde.js) — l'agent tombe alors dans une boucle de tours
  // sans jamais répondre (num_turns = maxTours + 1, réponse vide). Un cwd neuf évite ce chevauchement ;
  // launch.root reste la racine réelle (c'est de là que --settings résout framework/claude/…).
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-e2e-passerelle-'));
  const launch = {
    root: ROOT,
    chemin: 'e2e-passerelle-test',
    meta,
    fournisseur,
    env: process.env,
    permissionMode: 'bypassPermissions',
    maxTours: 1,
    budget: 0.20, // ≥ 0,20 USD : 0,05 ne suffit pas au premier tour à cache froid (constat de la sonde §12.3)
    denied: [],
    addDirs: [],
    params: { outils_cli: 'Read', autocompact_tokens: 400000 },
    prompt: 'Réponds strictement par le seul mot PASSERELLE_E2E_OK, sans rien ajouter.',
    systemPrompt: 'Tu es sondé par un test automatisé. Réponds exactement PASSERELLE_E2E_OK et rien d\'autre.',
    cwd,
  };

  const prep = passerelle.preparer(launch, launch.params);
  let brut;
  try {
    brut = passerelle.executer(prep, { timeoutMs: 60000 });
  } finally {
    if (prep.nettoyer) prep.nettoyer();
    fs.rmSync(cwd, { recursive: true, force: true });
  }

  const jeton = process.env[JETON_VAR] || '';
  const url = process.env[URL_VAR] || '';
  const stderrTexte = String(brut.stderr || '');
  if (jeton) assert.ok(!stderrTexte.includes(jeton), 'le jeton du fournisseur ne doit jamais apparaître sur stderr');
  if (url) assert.ok(!stderrTexte.includes(url), 'l\'URL du fournisseur ne doit jamais apparaître sur stderr (accepté seulement si elle ne contient aucun secret)' );

  const res = passerelle.normaliser(brut);
  const resTexte = JSON.stringify(res);
  if (jeton) assert.ok(!resTexte.includes(jeton), 'le jeton du fournisseur ne doit jamais apparaître dans le résultat normalisé');

  assert.equal(res.fin, 'success', `session non réussie : ${JSON.stringify({ fin: res.fin, sous_type: res.sous_type, statut_http: res.statut_http })}`);
  assert.ok(res.modeles.some((m) => m.id === meta.modele_reel), `modèle réel attendu ${meta.modele_reel} absent de ${JSON.stringify(res.modeles)}`);
  assert.ok(typeof res.cout_usd === 'number' && res.cout_usd > 0, `coût non nul attendu, reçu ${res.cout_usd}`);
});
