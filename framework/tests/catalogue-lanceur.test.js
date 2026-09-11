'use strict';
// Câblage du lanceur sur le catalogue de modèles (chantier 9, volet 2 — `docs/IMPLEMENTATION.md` §11.2) :
// précédence option CLI > fiche > politique > défauts, fournisseur et modèle réel résolus au lancement,
// coût calculé par le catalogue et colonne « Fournisseur / modèle réel » de SESSIONS.md.
// Aucune clé de fournisseur requise : les variables d'environnement sont posées par le test lui-même.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const launcher = require(path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'));
const { catalogue } = launcher;

const URL_VAR = 'HOLARCH_FOURNISSEUR_TEST_URL';
const JETON_VAR = 'HOLARCH_FOURNISSEUR_TEST_JETON';
const URL_TEST = 'https://fournisseur.invalid/v1';

const CONFIG_1_11 = `# Configuration — mission : test-catalogue
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

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | xhigh |
| execution | sonnet | low |
`;

const TABLES = `
## Fournisseurs
| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |
|---|---|---|---|---|
| anthropic | claude-code | — | — | secours-test |
| secours-test | passerelle | ${URL_VAR} | ${JETON_VAR} | — |

## Catalogue de modèles
| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent |
|---|---|---|---|---|---|---|
| opus | anthropic | claude-opus-5 | low…max | 15 / 75 | conception | opus@secours |
| sonnet | anthropic | claude-sonnet-5 | low…high | 3 / 15 | execution | — |
| opus@secours | secours-test | anthropic/claude-opus-5 | — | 20 / 80 | conception | — |
`;

const CONFIG = CONFIG_1_11 + TABLES;
const CAT = catalogue.parseCatalogue(CONFIG);

function fiche(chemin, { profil = '', effort = '', modele = '' } = {}) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | concepteur |\n| Statut | READY |\n| Budget alloué / consommé | 1 / 0 |\n`
    + `${profil ? `| Profil | ${profil} |\n` : ''}${modele ? `| Modèle | ${modele} |\n` : ''}${effort ? `| Effort | ${effort} |\n` : ''}| Livrables | — |\n`;
}

/** Racine de mission jetable : le strict nécessaire à `prepareLaunch` pour un enfant. */
function makeRoot(config = CONFIG, ficheEnfant = fiche('concepteur/enfant', { profil: 'execution', modele: 'opus@secours' })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-catalogue-'));
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  w('framework/KERNEL.md', '# KERNEL de test\n');
  w('framework/CONFIG.md', config);
  w('framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\n');
  w('framework/modules/registre/sharded-files.md', '# Module : sharded-files\n');
  w('mission/OBJECTIVE.md', 'Objectif de test.\n');
  w('mission/concepteur/enfant/ROLE.md', '# Rôle : enfant\n');
  w('mission/concepteur/enfant/MEMORY.md', '# Mémoire\n');
  w('mission/concepteur/enfant/STATUS.md', '# Statut\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n| Note | — |\n');
  w('mission/concepteur/enfant/INBOX.md', '# Boîte\n');
  w('mission/registry/instances/concepteur-enfant.md', ficheEnfant);
  return root;
}

/** Exécute `fn` avec un environnement de fournisseur posé, et le restaure ensuite. */
function avecEnv(vars, fn) {
  const avant = {};
  for (const [k, v] of Object.entries(vars)) { avant[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('parseFiche : ligne « Modèle » facultative', () => {
  assert.equal(launcher.parseFiche(fiche('a/b', { modele: 'opus@secours' })).modele, 'opus@secours');
  assert.equal(launcher.parseFiche(fiche('a/b', { profil: 'execution' })).modele, '');
});

test('resolveProfile : précédence option CLI > fiche > politique > défauts', () => {
  const cfg = launcher.parseConfig(CONFIG);
  const sansModele = launcher.parseFiche(fiche('a/b', { profil: 'execution' }));
  const avecModele = launcher.parseFiche(fiche('a/b', { profil: 'execution', modele: 'opus@secours' }));
  const politique = launcher.resolveProfile(cfg, sansModele, 'a/b', {});
  assert.equal(politique.modele, 'sonnet');
  assert.equal(politique.origine_modele, 'config');
  const parFiche = launcher.resolveProfile(cfg, avecModele, 'a/b', {});
  assert.equal(parFiche.modele, 'opus@secours');
  assert.equal(parFiche.origine_modele, 'fiche');
  const parOption = launcher.resolveProfile(cfg, avecModele, 'a/b', { modele: 'opus' });
  assert.equal(parOption.modele, 'opus');
  assert.equal(parOption.origine_modele, 'option');
  // Défauts : profil inconnu de la politique, aucune ligne de fiche.
  const defauts = launcher.resolveProfile(launcher.parseConfig(CONFIG_1_11.replace(/## Politique[\s\S]*$/, '')), sansModele, 'a/b', {});
  assert.equal(defauts.modele, launcher.DEFAULT_POLICY.execution.modele);
  assert.equal(defauts.origine_modele, 'defaut');
});

test('enrichirMeta : fournisseur, modèle réel et tarif du catalogue', () => {
  const m = launcher.enrichirMeta({ modele: 'opus@secours', effort: 'high' }, CAT, 'a/b', {});
  assert.equal(m.fournisseur, 'secours-test');
  assert.equal(m.modele_reel, 'anthropic/claude-opus-5');
  assert.equal(m.tarif.cout_entree, 20);
  assert.equal(m.repli_depuis, null);
  assert.equal(launcher.enrichirMeta({ modele: 'opus', effort: 'high' }, CAT, 'a/b', { repliDepuis: 'anthropic' }).repli_depuis, 'anthropic');
});

test('enrichirMeta : identifiant hors catalogue passé tel quel (compatibilité 1.11)', () => {
  const vide = catalogue.parseCatalogue(CONFIG_1_11);
  assert.equal(vide.aCatalogue, false);
  for (const cat of [CAT, vide]) {
    const m = launcher.enrichirMeta({ modele: 'claude-opus-5', effort: 'high' }, cat, 'a/b', {});
    assert.equal(m.fournisseur, null);
    assert.equal(m.modele_reel, 'claude-opus-5');
    assert.equal(m.tarif, null);
  }
});

test('fournisseurPour : URL et jeton lus dans l\'environnement, jamais dans CONFIG.md', () => {
  const m = launcher.enrichirMeta({ modele: 'opus@secours', effort: 'high' }, CAT, 'a/b', {});
  const avec = launcher.fournisseurPour(CAT, m, { [URL_VAR]: URL_TEST, [JETON_VAR]: 'jeton-de-test' });
  assert.equal(avec.nom, 'secours-test');
  assert.equal(avec.executeur, 'passerelle');
  assert.equal(avec.url, URL_TEST);
  assert.equal(avec.jeton, 'jeton-de-test');
  assert.equal(avec.modele_reel, 'anthropic/claude-opus-5');
  // Variables absentes : le lancement reste possible, sans URL ni jeton (avertissement, jamais un échec).
  assert.equal(launcher.fournisseurPour(CAT, m, {}).url, null);
  assert.equal(launcher.fournisseurPour(CAT, m, {}).jeton, null);
  // Modèle du fournisseur par défaut : pas de variable déclarée.
  const anthropic = launcher.fournisseurPour(CAT, launcher.enrichirMeta({ modele: 'opus', effort: 'high' }, CAT, 'a/b', {}), {});
  assert.equal(anthropic.nom, 'anthropic');
  assert.equal(anthropic.url_var, null);
  assert.equal(anthropic.secours, 'secours-test');
  assert.equal(launcher.fournisseurPour(CAT, { modele: 'inconnu' }, {}), null);
});

test('prepareLaunch : une ligne « Modèle » de fiche conduit l\'enfant chez un autre fournisseur', () => {
  const root = makeRoot();
  avecEnv({ [URL_VAR]: URL_TEST, [JETON_VAR]: 'jeton-de-test', HOLARCH_FAKE_CLAUDE: null }, () => {
    const l = launcher.prepareLaunch(root, 'concepteur/enfant', {});
    assert.equal(l.meta.modele, 'opus@secours'); // la politique du profil « execution » dit `sonnet`
    assert.equal(l.meta.fournisseur, 'secours-test');
    assert.equal(l.meta.modele_reel, 'anthropic/claude-opus-5');
    assert.equal(l.executeur, 'passerelle'); // colonne « Exécuteur » de la table Fournisseurs
    assert.equal(l.fournisseur.url, URL_TEST);
    const apercu = launcher.apercuCommande(l);
    // Le fournisseur reçoit le **modèle réel**, jamais l'identifiant HOLARCH.
    assert.ok(apercu.args.includes('anthropic/claude-opus-5'), apercu.args.join(' '));
    assert.ok(!apercu.args.includes('opus@secours'), apercu.args.join(' '));
  });
});

test('prepareLaunch : un CONFIG.md 1.11 (sans les deux tables) reste exécutable, inchangé', () => {
  const root = makeRoot(CONFIG_1_11, fiche('concepteur/enfant', { profil: 'execution' }));
  avecEnv({ HOLARCH_FAKE_CLAUDE: null }, () => {
    const l = launcher.prepareLaunch(root, 'concepteur/enfant', {});
    assert.equal(l.meta.modele, 'sonnet');
    assert.equal(l.meta.fournisseur, null);
    assert.equal(l.meta.modele_reel, 'sonnet');
    assert.equal(l.fournisseur, null);
    assert.equal(l.executeur, 'claude-code');
    assert.ok(launcher.apercuCommande(l).args.includes('sonnet'));
  });
});

const RES = (cout) => ({
  session_id: 's-1', tours: 3, cout_usd: cout, tokens: { entree: 1000000, cache_lu: 0, cache_ecrit: 0, sortie: 0 },
  modeles: [], fin: 'success', sous_type: 'success', refus: 0, statut_http: null, texte: '', brut: null,
});

test('appendSessionLine : colonne « Fournisseur / modèle réel », coût « ≈ » du catalogue, marque de repli', () => {
  const root = makeRoot();
  const meta = launcher.enrichirMeta({ modele: 'opus', effort: 'high' }, CAT, 'concepteur/enfant', {});
  const ligne = (m, res) => launcher.appendSessionLine(root, 'test', 'concepteur/enfant', m, res, 1000, 'DELIVERED', { systeme: 10, utilisateur: 20 });

  const estimee = ligne(meta, RES(null));
  assert.match(estimee, /\| ≈ 15\.0000 \|/); // 1 Mtok d'entrée × 15 USD/Mtok
  assert.match(estimee, /\| anthropic \/ claude-opus-5 \|/);
  const entete = fs.readFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), 'utf8').split('\n').find((l) => l.startsWith('| Date (UTC)'));
  assert.match(entete, /\| Fournisseur \/ modèle réel \|$/);

  // Coût rapporté par l'exécuteur : jamais recalculé, jamais marqué.
  assert.match(ligne(meta, RES(2.5)), /\| 2\.5000 \|/);

  // Session de repli (volet 3) : la marque vit dans la colonne « Fin ».
  const repli = ligne(launcher.enrichirMeta({ modele: 'opus@secours', effort: 'high' }, CAT, 'concepteur/enfant', { repliDepuis: 'anthropic' }), RES(null));
  assert.match(repli, /success · repli depuis anthropic \|/);
  assert.match(repli, /\| secours-test \/ anthropic\/claude-opus-5 \|/);

  // Sans catalogue : cellule « — » et coût inconnu plutôt qu'un zéro inventé.
  const sansCatalogue = ligne(launcher.enrichirMeta({ modele: 'opus', effort: 'high' }, catalogue.parseCatalogue(CONFIG_1_11), 'concepteur/enfant', {}), RES(null));
  assert.match(sansCatalogue, /\| \? \|/);
  assert.match(sansCatalogue, /\| — \|\n?$/);

  // Cumul : une estimation compte comme un coût rapporté (15 + 2,5 + 20 + 0).
  assert.equal(Math.round(launcher.coutCumule(root, 'concepteur/enfant') * 100) / 100, 37.5);
});

test('lastContexteDepart : colonne repérée par sa forme, quel que soit le nombre de colonnes', () => {
  const root = makeRoot();
  const p = launcher.ensureSessionsFile(root, 'test');
  const ancienne = '| 2026-09-11T10:00:00Z | concepteur/enfant | s-0 | opus/high | 12 | 1 / 2 / 3 / 4 | 1.0000 | 1s | success | DELIVERED | 10 / 20 | 46391 / 153215 |\n';
  fs.appendFileSync(p, ancienne);
  assert.equal(launcher.lastContexteDepart(root, 'concepteur/enfant'), '46391');
  fs.appendFileSync(p, ancienne.replace(' |\n', ' | anthropic / claude-opus-5 |\n').replace('46391', '51200'));
  assert.equal(launcher.lastContexteDepart(root, 'concepteur/enfant'), '51200');
});

// Chantier 9 §11.2 (élagage) : les tables « Fournisseurs » et « Catalogue de modèles » sont des données
// du lanceur, jamais du contrat d'une instance — retirées du prompt système injecté au réveil.

test('buildSystemPrompt : sections « Fournisseurs » et « Catalogue de modèles » élaguées du prompt système', () => {
  const root = makeRoot(CONFIG);
  const cfg = launcher.parseConfig(CONFIG);
  const prompt = launcher.buildSystemPrompt(root, cfg, false);
  assert.ok(!prompt.includes('## Fournisseurs'), prompt);
  assert.ok(!prompt.includes('## Catalogue de modèles'), prompt); // le titre « Catalogue de modèles » seul reste dans la note d'élagage
  assert.ok(!prompt.includes('Coût entrée / sortie'), prompt); // contenu de la table, jamais le simple mot dans la note
  assert.ok(!prompt.includes('HOLARCH_FOURNISSEUR_'), prompt);
  assert.ok(prompt.includes('## Modules actifs'));
  assert.ok(prompt.includes('## Paramètres'));
  assert.ok(prompt.includes('## Politique de modèle'));
  assert.match(prompt, /<fichier chemin="framework\/CONFIG\.md" note="sections « Fournisseurs » et « Catalogue de modèles » retirées[^"]*">/);
});

test('buildSystemPrompt : un CONFIG.md 1.11 (sans les deux tables) reste injecté inchangé, sans note d\'élagage', () => {
  const root = makeRoot(CONFIG_1_11);
  const cfg = launcher.parseConfig(CONFIG_1_11);
  const prompt = launcher.buildSystemPrompt(root, cfg, false);
  assert.match(prompt, /<fichier chemin="framework\/CONFIG\.md">\n/); // pas d'attribut note : bloc inchangé
  assert.ok(prompt.includes(CONFIG_1_11.trim()));
});

test('elaguerSectionsLanceur : la section suivante est conservée ; un texte sans les deux tables est renvoyé identique', () => {
  const texte = [
    '# Configuration — mission : test',
    '## Fournisseurs',
    '| Nom | Exécuteur |',
    '|---|---|',
    '| anthropic | claude-code |',
    '',
    '## Paramètres',
    '| Paramètre | Valeur |',
    '|---|---|',
    '| isolation | aucune |',
  ].join('\n') + '\n';
  const reduit = launcher.elaguerSectionsLanceur(texte);
  assert.ok(!reduit.includes('## Fournisseurs'));
  assert.ok(reduit.includes('## Paramètres'));
  assert.ok(reduit.includes('| isolation | aucune |'));
  // Texte sans les deux tables (CONFIG.md 1.11) : renvoyé strictement identique.
  assert.equal(launcher.elaguerSectionsLanceur(CONFIG_1_11), CONFIG_1_11);
});
