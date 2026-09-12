'use strict';
// Chantier 9, volet 2 (docs/IMPLEMENTATION.md §11.2) : catalogue de modèles et fournisseurs.
// Sans dépendance externe, sans clé de fournisseur, sans accès réseau. Le test le plus important de
// ce fichier est celui de compatibilité ascendante (§2) : un CONFIG.md 1.11, qui ne porte aucune des
// deux tables, doit donner un catalogue vide et laisser passer l'identifiant de modèle tel quel.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const CIBLE = path.resolve(__dirname, '..');
const cat = require(path.join(CIBLE, 'bin', 'catalogue.js'));

const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg} : ${a} ≠ ${b}`);

/** Catalogue par défaut du framework : le bloc ```markdown``` du preset `solo-light`, pas le CONFIG.md
 *  réel de la racine — celui-ci est réécrit à chaque mission (`open.js`, catalogue de mission, `Secours`
 *  armé…) et ne mesure pas le framework mais l'état du dépôt où le banc tourne. */
function configDuPreset() {
  const brut = fs.readFileSync(path.join(CIBLE, 'presets', 'solo-light.md'), 'utf8');
  const m = brut.match(/```markdown\n([\s\S]*?)\n```/);
  assert.ok(m, 'bloc ```markdown``` du preset introuvable');
  return m[1];
}

/** CONFIG.md version 1.11 : aucune des deux tables. Écrit ici plutôt que lu à la racine du dépôt —
 *  le banc d'essai superpose justement le CONFIG.md cible sur celui de la racine, et ce test doit
 *  mesurer la compatibilité ascendante, pas l'état du dépôt dans lequel il tourne. */
const SANS_TABLES = `# Configuration — mission : ancienne

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |

## Paramètres
| Paramètre | Valeur |
|---|---|
| profondeur_max | 2 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | high |
`;

/** Catalogue d'essai écrit en toutes lettres : deux fournisseurs, une équivalence déclarée une seule fois. */
const DEUX_FOURNISSEURS = `# Configuration — mission : essai

## Fournisseurs
| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |
|---|---|---|---|---|
| anthropic | claude-code | — | — | openrouter |
| openrouter | passerelle | HOLARCH_FOURNISSEUR_OPENROUTER_URL | HOLARCH_FOURNISSEUR_OPENROUTER_JETON | — |

## Catalogue de modèles
| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent |
|---|---|---|---|---|---|---|
| opus | anthropic | claude-opus-5 | low…max | 15 / 75 | conception, relecture | opus@openrouter |
| opus@openrouter | openrouter | anthropic/claude-opus-5 | — | 15 / 75 | conception | — |
`;

/** Entrée dont le tarif et les efforts sont inconnus (colonnes « — »). Écrite ici plutôt que lue dans
 *  le CONFIG.md de la mission : le comportement mesuré est celui du catalogue face à une cellule vide,
 *  pas la présence d'un modèle donné dans la table du dépôt, qui peut légitimement changer. */
const SANS_TARIF = `# Configuration — mission : essai

## Catalogue de modèles
| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent |
|---|---|---|---|---|---|---|
| inconnu | anthropic | modele-sans-prix | — | — | exploration | — |
`;

// -- 1. Les deux tables du CONFIG.md cible ---------------------------------------------------------

test('parseCatalogue lit les deux tables du CONFIG.md par défaut (preset solo-light)', () => {
  const c = cat.parseCatalogue(configDuPreset());
  assert.equal(c.aFournisseurs, true);
  assert.equal(c.aCatalogue, true);
  assert.deepEqual(Object.keys(c.fournisseurs), ['anthropic', 'openrouter']);
  assert.equal(c.fournisseurs.anthropic.executeur, 'claude-code');
  assert.equal(c.fournisseurs.anthropic.url_var, null); // « — » ⇒ null, jamais la chaîne « — »
  assert.equal(c.fournisseurs.openrouter.executeur, 'passerelle');
  assert.equal(c.fournisseurs.openrouter.jeton_var, 'HOLARCH_FOURNISSEUR_OPENROUTER_JETON');
  assert.equal(Object.keys(c.modeles).length, 4);
  const opus = cat.modele(c, 'opus');
  assert.equal(opus.fournisseur, 'anthropic');
  assert.equal(opus.modele_reel, 'claude-opus-5');
  assert.deepEqual(opus.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(opus.cout_entree, 5); // tarif liste réel d'Opus 5 (1.21.0 ; 15 / 75 était celui d'Opus 4)
  assert.equal(opus.cout_sortie, 25);
  assert.deepEqual(cat.verifierCatalogue(c), []);
  assert.equal(cat.fournisseurDe(c, 'sonnet').nom, 'anthropic');
});

// -- 2. Compatibilité ascendante (critère d'acceptation du chantier) -------------------------------

test('un CONFIG.md sans les deux tables donne un catalogue vide, et le modèle passe tel quel', () => {
  const c = cat.parseCatalogue(SANS_TABLES);
  assert.equal(c.aFournisseurs, false);
  assert.equal(c.aCatalogue, false);
  assert.deepEqual(Object.keys(c.fournisseurs), []);
  assert.deepEqual(Object.keys(c.modeles), []);
  assert.equal(cat.modeleReel(c, 'opus'), 'opus');
  assert.equal(cat.modele(c, 'opus'), null);
  assert.equal(cat.fournisseurDe(c, 'opus'), null);
  assert.deepEqual(cat.verifierCatalogue(c), []);
  // Même chose sans aucun catalogue du tout (appelant qui n'en a pas) : aucune exception.
  assert.equal(cat.modeleReel(null, 'claude-opus-5'), 'claude-opus-5');
  assert.equal(cat.effortPermis(null, 'max'), true);
});

// -- 3. Colonnes « Efforts » et « Coût » -----------------------------------------------------------

test('parseEfforts : intervalle, liste, vide, intervalle inversé', () => {
  assert.deepEqual(cat.parseEfforts('low…max'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(cat.parseEfforts('low...high'), ['low', 'medium', 'high']);
  assert.deepEqual(cat.parseEfforts('low, high'), ['low', 'high']);
  assert.equal(cat.parseEfforts('—'), null); // pas de contrainte connue, ≠ aucun effort permis
  assert.deepEqual(cat.parseEfforts('max…low'), []); // illisible : aucune valeur permise
});

test('parseTarif : forme courte, forme longue (cache explicite), vide, illisible', () => {
  assert.deepEqual(cat.parseTarif('15 / 75'), [15, 75, null, null]);
  assert.deepEqual(cat.parseTarif('1,5/7,5'), [1.5, 7.5, null, null]);
  assert.deepEqual(cat.parseTarif('10 / 50 / 12,50 / 0,25'), [10, 50, 12.5, 0.25]);
  assert.deepEqual(cat.parseTarif('—'), [null, null, null, null]);
  assert.deepEqual(cat.parseTarif('quinze'), [null, null, null, null]);
  assert.deepEqual(cat.parseTarif('10 / 50 / 12,50'), [null, null, null, null]); // trois valeurs : ni l'une ni l'autre forme
});

// -- 4. Coût estimé (le lanceur s'en sert quand l'exécuteur ne rapporte rien) -----------------------

test('coutEstime applique le tarif du catalogue, cache lu au dixième et cache écrit à 125 %', () => {
  const c = cat.parseCatalogue(DEUX_FOURNISSEURS);
  const opus = cat.modele(c, 'opus');
  proche(cat.coutEstime(opus, { entree: 1e6 }), 15, 'entrée');
  proche(cat.coutEstime(opus, { cache_lu: 1e6 }), 1.5, 'cache lu');
  proche(cat.coutEstime(opus, { cache_ecrit: 1e6 }), 18.75, 'cache écrit');
  proche(cat.coutEstime(opus, { sortie: 1e6 }), 75, 'sortie');
  proche(cat.coutEstime(opus, { entree: 1e4, cache_lu: 1e6, cache_ecrit: 5e4, sortie: 2e4 }), 4.0875, 'session réaliste');
});

test('coutEstime : un tarif de cache écrit au catalogue prime sur la dérivation', () => {
  // `claude-fable-5-1` facture la lecture de cache à 0,25 par Mtok, soit 2,5 % de son tarif d'entrée
  // et non le dixième dérivé par défaut — c'est le cas qui a motivé la forme longue de la colonne.
  const c = cat.parseCatalogue(fs.readFileSync(path.join(CIBLE, 'CONFIG.md'), 'utf8'));
  const fable = cat.modele(c, 'fable');
  assert.deepEqual([fable.cout_entree, fable.cout_sortie, fable.cout_cache_ecrit, fable.cout_cache_lu], [10, 50, 12.5, 0.25]);
  proche(cat.coutEstime(fable, { cache_lu: 1e6 }), 0.25, 'cache lu au tarif publié, pas 1,00 dérivé');
  proche(cat.coutEstime(fable, { cache_ecrit: 1e6 }), 12.5, 'cache écrit au tarif publié');
  proche(cat.coutEstime(fable, { entree: 1e6, sortie: 1e6 }), 60, 'entrée + sortie');
  // Forme courte : la dérivation reste en vigueur, modèle par modèle.
  const court = cat.modele(cat.parseCatalogue(DEUX_FOURNISSEURS), 'opus');
  assert.equal(court.cout_cache_lu, null);
  proche(cat.coutEstime(court, { cache_lu: 1e6 }), 1.5, 'dérivation inchangée sans tarif de cache');
});

test('coutEstime rend null plutôt qu\'un zéro inventé', () => {
  const c = cat.parseCatalogue(DEUX_FOURNISSEURS);
  assert.equal(cat.coutEstime(cat.modele(c, 'opus'), {}), null); // aucun décompte de tokens
  assert.equal(cat.coutEstime(cat.modele(c, 'opus'), null), null);
  assert.equal(cat.coutEstime(null, { entree: 1e6 }), null); // modèle hors catalogue
  const sansTarif = cat.modele(cat.parseCatalogue(SANS_TARIF), 'inconnu');
  assert.equal(sansTarif.cout_entree, null);
  assert.equal(cat.coutEstime(sansTarif, { entree: 1e6, sortie: 1e6 }), null); // tarif inconnu ⇒ pas d'estimation
});

// -- 5. Efforts permis -----------------------------------------------------------------------------

test('effortPermis suit la colonne Efforts, et ne bloque rien quand elle est vide', () => {
  const c = cat.parseCatalogue(fs.readFileSync(path.join(CIBLE, 'CONFIG.md'), 'utf8'));
  assert.equal(cat.effortPermis(cat.modele(c, 'sonnet'), 'high'), true);
  assert.equal(cat.effortPermis(cat.modele(c, 'sonnet'), 'xhigh'), false);
  assert.equal(cat.effortPermis(cat.modele(cat.parseCatalogue(SANS_TARIF), 'inconnu'), 'max'), true); // efforts inconnus ⇒ permis
});

// -- 6. Secours et équivalences (ce dont le repli 429 du volet 3 se servira) ------------------------

test('secoursDe et equivalentChez, dans les deux sens, sans double déclaration', () => {
  const c = cat.parseCatalogue(DEUX_FOURNISSEURS);
  assert.equal(cat.secoursDe(c, 'anthropic'), 'openrouter');
  assert.equal(cat.secoursDe(c, 'openrouter'), null);
  assert.equal(cat.equivalentChez(c, 'opus', 'openrouter'), 'opus@openrouter');
  // Sens inverse : l'équivalence n'est déclarée que sur `opus`, elle est lue à l'envers pour revenir.
  assert.equal(cat.equivalentChez(c, 'opus@openrouter', 'anthropic'), 'opus');
  assert.equal(cat.equivalentChez(c, 'opus', 'fournisseur-inexistant'), null);
  assert.equal(cat.equivalentChez(c, 'modele-inconnu', 'openrouter'), null);
  // Catalogue par défaut (preset) : aucune équivalence déclarée ⇒ aucun repli possible, comportement d'attente.
  const defaut = cat.parseCatalogue(configDuPreset());
  assert.equal(cat.secoursDe(defaut, 'anthropic'), null);
  assert.equal(cat.equivalentChez(defaut, 'opus', 'openrouter'), null);
});

// -- 7. Cohérence interne --------------------------------------------------------------------------

test('verifierCatalogue nomme chaque référence croisée cassée', () => {
  const fautif = `## Fournisseurs
| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |
|---|---|---|---|---|
| anthropic | claude-code | — | — | anthropic |
| bancal | | — | — | inconnu |

## Catalogue de modèles
| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent |
|---|---|---|---|---|---|---|
| opus | pas-declare | claude-opus-5 | low…max | 15 / 75 | conception | absent-du-catalogue |
| creux | anthropic | | max…low | — | — | — |
`;
  const ecarts = cat.verifierCatalogue(cat.parseCatalogue(fautif));
  const contient = (motif) => assert.ok(ecarts.some((e) => e.includes(motif)), `écart attendu « ${motif} » dans ${JSON.stringify(ecarts)}`);
  contient('secours de lui-même');
  contient('sans exécuteur');
  contient('secours « inconnu » non déclaré');
  contient('fournisseur « pas-declare » non déclaré');
  contient('équivalent « absent-du-catalogue » absent du catalogue');
  contient('sans modèle réel');
  contient('colonne Efforts illisible');
});
