'use strict';
// Test des kits de domaine (chantier 17, docs/IMPLEMENTATION.md §17.2, mission holarch-specialisation).
// Modèle : framework/tests/regles-du-metier.test.js (racine jetable, require du lanceur, `pick`/`trouverDepot`
// pour fonctionner aux deux emplacements — dans le paquet promouvable et après promotion sous framework/tests/).
//
// Ici, deux niveaux de fixture :
//  - `kits.js` (nomsDesLignes, sections, kitsAttaches, resoudreKits, blocKits, refusKits) ne touche qu'à
//    `root` (mission/, framework/kits/) : les tests a/b/e/g le requièrent directement, sans reconstruire tout
//    `framework/`.
//  - `buildUserPromptDetail` et le CLI (tests c/d/f) exigent le lanceur réel avec les trois fragments du
//    chantier 17 posés dans holarch-spawn.js : un unique « gabarit » (racine temporaire où le paquet a été
//    appliqué, cibles `framework/bin/*` seulement) est construit une fois pour tout le fichier, puis chaque
//    test y ajoute ses propres fixtures d'instance (mission/<chemin>/ROLE.md, mission/OBJECTIVE.md,
//    framework/kits/<nom>/INDEX.md) dans une racine légère séparée quand seule la lecture de fichiers compte
//    (buildUserPromptDetail ne lit que `root`, jamais le lanceur lui-même).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CIBLE = path.resolve(__dirname, '..'); // framework/ du paquet (ou du dépôt, si déjà promu)

/** Premier ancêtre qui porte à la fois le lanceur et config-lint : le dépôt, que ce fichier tourne
 *  dans le paquet promouvable (dépôt = ancêtre lointain) ou déjà promu (dépôt = ancêtre immédiat). */
function trouverDepot(depart) {
  let d = depart;
  for (;;) {
    if (fs.existsSync(path.join(d, 'framework', 'bin', 'holarch-spawn.js'))
      && fs.existsSync(path.join(d, 'tools', 'config-lint', 'config-lint.js'))) return d;
    const parent = path.dirname(d);
    if (parent === d) throw new Error(`dépôt introuvable en remontant depuis ${depart}`);
    d = parent;
  }
}
const DEPOT = trouverDepot(path.resolve(__dirname, '..', '..'));

/** Fichier de CIBLE (le `framework/` du paquet ou du dépôt) s'il existe, sinon celui du dépôt réel. */
function pick(rel) {
  const p = path.join(CIBLE, rel);
  return fs.existsSync(p) ? p : path.join(DEPOT, 'framework', rel);
}

// Le paquet lui-même (mission/shared/concepteur : contient appliquer.js et MANIFEST.json), utile
// seulement en mode « paquet » (voir PROMU ci-dessous).
const PAQUET = path.resolve(__dirname, '..', '..', '..');

// Mode « promu » : kits.js et le require('./kits') du lanceur sont déjà dans le dépôt réel — inutile
// de reconstruire quoi que ce soit, on prend directement le lanceur du dépôt.
const PROMU = fs.existsSync(path.join(DEPOT, 'framework', 'bin', 'kits.js'))
  && fs.readFileSync(path.join(DEPOT, 'framework', 'bin', 'holarch-spawn.js'), 'utf8').includes("require('./kits')");

/** Racine temporaire portant `framework/` (avec kits.js + les trois fragments, appliqués si nécessaire)
 *  et `tools/message-lint` (requis indirectement par le lanceur). Jamais le dépôt réel. */
function construireGabarit() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-kits-gabarit-'));
  fs.cpSync(path.join(DEPOT, 'framework'), path.join(root, 'framework'), { recursive: true });
  fs.cpSync(path.join(DEPOT, 'tools', 'message-lint'), path.join(root, 'tools', 'message-lint'), { recursive: true });
  if (!PROMU) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const APPLIQUER = require(path.join(PAQUET, 'appliquer.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(PAQUET, 'MANIFEST.json'), 'utf8'));
    // Cibles framework/bin/* seulement : le reste du paquet (regles-du-metier.md, preset artefacts,
    // ce test lui-même, etc.) n'a rien à faire dans ce gabarit-là et n'est pas déclaré ici — la
    // réconciliation manifeste <-> paquet de `verifierTout` (via `oublies`) ne nous concerne donc pas :
    // on ne s'appuie que sur `verifications[].resultat.ok`, jamais sur `erreurs`.
    const manifestFiltre = { cibles: manifest.cibles.filter((c) => c.vers.startsWith('framework/bin/')) };
    const { verifications } = APPLIQUER.verifierTout(PAQUET, root, manifestFiltre);
    for (const v of verifications) {
      assert.ok(v.resultat.ok, `cible ${v.cible.vers} refusée en vérification : ${v.resultat.motif}`);
    }
    const resultat = APPLIQUER.appliquerTransactionnel(verifications);
    assert.ok(resultat.ok, `application du gabarit échouée : ${resultat.motif}`);
  }
  return root;
}

const GABARIT = construireGabarit();
test.after(() => fs.rmSync(GABARIT, { recursive: true, force: true }));

const LANCEUR = require(path.join(GABARIT, 'framework', 'bin', 'holarch-spawn.js'));
const K = require(pick('bin/kits.js'));

/** Racine légère (mission/ + framework/kits/ seulement) pour les tests qui n'appellent que des
 *  fonctions lisant `root` (kitsAttaches, resoudreKits, buildUserPromptDetail) — jamais le dépôt réel. */
function nouvelleRacine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-kits-fixture-'));
  return root;
}
function ecrire(root, relatif, texte) {
  const p = path.join(root, relatif);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, texte, 'utf8');
}
function ecrireKit(root, nom, texteIndex) {
  ecrire(root, path.join('framework', 'kits', nom, 'INDEX.md'), texteIndex);
}

// --- a. nomsDesLignes -------------------------------------------------------------------------

test('nomsDesLignes : formes tolérées (gras, backticks, commentaire, « aucun »/« — ») et dédoublonnage', () => {
  assert.deepEqual(K.nomsDesLignes(['- Kits : media, video']), ['media', 'video']);
  assert.deepEqual(K.nomsDesLignes(['- **Kits** : `media` — commentaire']), ['media']);
  assert.deepEqual(K.nomsDesLignes(['Kits : —']), []);
  assert.deepEqual(K.nomsDesLignes(['- Kits : aucun']), []);
  assert.deepEqual(
    K.nomsDesLignes(['- Kits : media, video', '- Kits : video, audio']),
    ['media', 'video', 'audio'],
  );
});

// --- b. kitsAttaches ---------------------------------------------------------------------------

test('kitsAttaches : seule « Contexte hérité » du ROLE.md compte (une section Livrables est ignorée)', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'a', 'b', 'ROLE.md'), [
    '## Contexte hérité',
    '- Kits : media',
    '',
    '## Livrables',
    '- Kits : video',
    '',
  ].join('\n'));
  assert.deepEqual(K.kitsAttaches(root, 'a/b', {}), ['media']);
});

test('kitsAttaches : racine (chemin sans "/") ajoute aussi la section Ressources d\'OBJECTIVE.md', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'concepteur', 'ROLE.md'), '## Contexte hérité\n- Kits : media\n');
  ecrire(root, path.join('mission', 'OBJECTIVE.md'), '## Ressources\n- Kits : video\n');
  assert.deepEqual(K.kitsAttaches(root, 'concepteur', {}), ['media', 'video']);
});

test('kitsAttaches : bootstrap:true lit uniquement OBJECTIVE.md, même pour un chemin profond', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'a', 'b', 'ROLE.md'), '## Contexte hérité\n- Kits : media\n');
  ecrire(root, path.join('mission', 'OBJECTIVE.md'), '## Ressources\n- Kits : video\n');
  assert.deepEqual(K.kitsAttaches(root, 'a/b', { bootstrap: true }), ['video']);
});

// --- c. buildUserPromptDetail (réveil) -------------------------------------------------------

const META = {
  depth: 2, profil: 'execution', modele: 'opus', effort: 'low',
};
const PARAMS = {
  relances_max: 2, sessions_max_par_instance: 24, changements_regime_max: 1, seuil_contexte_tokens: 240000,
};

test('buildUserPromptDetail : bloc <kits> présent, contenu de l\'INDEX.md, note du bloc KITS', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'a', 'b', 'ROLE.md'), '## Contexte hérité\n- Kits : sondage\n');
  const indexTexte = '# Sondage\nContenu du kit de domaine « sondage ».\n';
  ecrireKit(root, 'sondage', indexTexte);
  const { prompt, blocs } = LANCEUR.buildUserPromptDetail(root, 'a/b', META, PARAMS, false, { modules: [] }, { dryRun: true });
  assert.ok(prompt.includes('<kits>'), 'bloc <kits> attendu');
  assert.ok(prompt.includes(indexTexte.trim()), 'contenu de l\'INDEX.md attendu dans le prompt');
  const blocKits = blocs.find((b) => b.nom === 'KITS');
  assert.ok(blocKits, 'bloc { nom: "KITS" } attendu dans blocs');
  assert.ok(blocKits.note.includes('sondage'), 'la note du bloc KITS cite le nom du kit');
  assert.ok(blocKits.note.includes(String(indexTexte.length)), 'la note du bloc KITS cite la taille de l\'INDEX.md');
});

test('buildUserPromptDetail : sans ligne Kits, ni <kits> ni bloc KITS', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'a', 'b', 'ROLE.md'), '## Contexte hérité\nRien de particulier.\n');
  const { prompt, blocs } = LANCEUR.buildUserPromptDetail(root, 'a/b', META, PARAMS, false, { modules: [] }, { dryRun: true });
  assert.equal(prompt.includes('<kits>'), false);
  assert.equal(blocs.some((b) => b.nom === 'KITS'), false);
});

test('buildUserPromptDetail : avec unites-indexees actif, <kits> vient après </reveil> et avant le bloc INBOX', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'a', 'b', 'ROLE.md'), '## Contexte hérité\n- Kits : sondage\n');
  ecrireKit(root, 'sondage', '# Sondage\n');
  const cfg = { modules: [{ categorie: 'memoire', module: 'unites-indexees' }] };
  const { prompt } = LANCEUR.buildUserPromptDetail(root, 'a/b', META, PARAMS, false, cfg, { dryRun: true });
  const iReveil = prompt.indexOf('</reveil>');
  const iKits = prompt.indexOf('<kits>');
  const iInbox = prompt.indexOf('<fichier chemin="mission/a/b/INBOX.md"');
  assert.ok(iReveil >= 0 && iKits >= 0 && iInbox >= 0, 'les trois repères doivent être présents');
  assert.ok(iReveil < iKits, '<kits> doit venir après </reveil>');
  assert.ok(iKits < iInbox, '<kits> doit venir avant le bloc INBOX');
});

// --- d. buildUserPromptDetail (bootstrap) ----------------------------------------------------

test('buildUserPromptDetail bootstrap : <kits> après le bloc OBJECTIVE', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'OBJECTIVE.md'), '## Ressources\n- Kits : media\n');
  ecrireKit(root, 'media', '# Media\n');
  const { prompt } = LANCEUR.buildUserPromptDetail(root, 'concepteur', META, PARAMS, true, { modules: [] }, { dryRun: true });
  const iObjective = prompt.indexOf('<fichier chemin="mission/OBJECTIVE.md"');
  const iKits = prompt.indexOf('<kits>');
  assert.ok(iObjective >= 0 && iKits >= 0, 'bloc OBJECTIVE et bloc <kits> attendus');
  assert.ok(iObjective < iKits, '<kits> doit venir après le bloc OBJECTIVE');
});

// --- e. refus (kit absent, nom invalide) -----------------------------------------------------

test('resoudreKits / refusKits : kit absent et nom invalide classés en absents, message les citant', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'a', 'b', 'ROLE.md'), '## Contexte hérité\n- Kits : manquant, Media_X\n');
  const res = K.resoudreKits(root, 'a/b', {});
  assert.equal(res.presents.length, 0);
  assert.equal(res.absents.length, 2);
  const manquant = res.absents.find((a) => a.nom === 'manquant');
  const invalide = res.absents.find((a) => a.nom === 'Media_X');
  assert.ok(manquant && /introuvable/.test(manquant.motif));
  assert.ok(invalide && /kebab-case/.test(invalide.motif));
  const message = K.refusKits('a/b', res);
  assert.ok(message.includes('manquant'), 'le message de refus doit citer « manquant »');
  assert.ok(message.includes('Media_X'), 'le message de refus doit citer « Media_X »');
});

test('refusKits : null quand tous les kits attachés sont présents', () => {
  const root = nouvelleRacine();
  ecrire(root, path.join('mission', 'a', 'b', 'ROLE.md'), '## Contexte hérité\n- Kits : sondage\n');
  ecrireKit(root, 'sondage', '# Sondage\n');
  const res = K.resoudreKits(root, 'a/b', {});
  assert.equal(K.refusKits('a/b', res), null);
});

// --- f. prepareLaunch / CLI --dry-run ---------------------------------------------------------
// prepareLaunch appelle claude/git (executeurs, fichePath...) : pas d'appel direct en processus dans
// ce test (réseau/CLI non garantis dans l'environnement de test). On passe par le sous-processus CLI
// en --dry-run (aucune session réelle lancée), sur une instance racine (« sonde », sans « / ») pour
// éviter toute dépendance à git-branches/worktree. Un lancement réel (sans --dry-run) sur un kit
// manquant lancerait une vraie session : non fait ici, remplacé par le test unitaire de refusKits
// ci-dessus (throw non observé directement, mais motif et message identiques à ceux que
// prepareLaunch relaierait tels quels — voir le fragment holarch-spawn.kits-refus.fragment.js).
test('CLI --dry-run : kit nommé absent, avertissement stderr et code 0 (aucun lancement réel)', () => {
  ecrire(GABARIT, path.join('mission', 'sonde', 'ROLE.md'), '# Rôle\nInstance de test (fixture kits.test.js).\n');
  ecrire(GABARIT, path.join('mission', 'sonde', 'STATUS.md'), '| État | Résultat |\n|---|---|\n| WORKING | — |\n');
  ecrire(GABARIT, path.join('mission', 'OBJECTIVE.md'), '## Ressources\n- Kits : fantome\n');
  const r = spawnSync(process.execPath, [
    path.join(GABARIT, 'framework', 'bin', 'holarch-spawn.js'),
    'sonde', '--dry-run', '--root', GABARIT,
  ], { encoding: 'utf8', cwd: GABARIT });
  assert.equal(r.status, 0, `code 0 attendu (dry-run) : stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stderr, /un lancement réel serait refusé/);
  assert.match(r.stderr, /fantome/);
});

// --- g. module.exports -------------------------------------------------------------------------

test('kits.js : module.exports porte les six fonctions attendues', () => {
  const texte = fs.readFileSync(pick('bin/kits.js'), 'utf8');
  for (const nom of ['nomsDesLignes', 'sections', 'kitsAttaches', 'resoudreKits', 'blocKits', 'refusKits']) {
    assert.ok(new RegExp(`\\b${nom}\\b`).test(texte.slice(texte.indexOf('module.exports'))), `${nom} attendu dans module.exports`);
  }
  for (const nom of ['nomsDesLignes', 'sections', 'kitsAttaches', 'resoudreKits', 'blocKits', 'refusKits']) {
    assert.equal(typeof K[nom], 'function', `K.${nom} doit être une fonction (require réel)`);
  }
});
