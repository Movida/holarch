'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OUTIL = path.join(__dirname, 'holarch-init.js');
const init = require(OUTIL);

const CATEGORIES_OBLIGATOIRES = ['orchestration', 'synchronisation', 'memoire', 'registre'];
const INCOMPATIBLES = [['fork-join', 'dependency-graph'], ['monolithic', 'journal-synthesis'], ['monolithic', 'unites-indexees'], ['journal-synthesis', 'unites-indexees']];

const REPONSES_SOLO = {
  mission: 'refonte-site', objectif: 'Refondre la page d\'accueil et ses trois sous-pages.',
  reussite: 'Les quatre pages sont en ligne et relues.',
  ampleur: 'solo', dependances: false, audit: false, suivi: true,
};
const REPONSES_EQUIPE = {
  mission: 'plateforme-paiement', objectif: 'Concevoir et livrer une API de paiement auditée.',
  reussite: '', ampleur: 'equipe', dependances: true, audit: true, suivi: true,
};

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-init-'));
}

test('le mode solo produit une configuration complète et cohérente', () => {
  const d = init.deriver(REPONSES_SOLO);
  assert.strictEqual(d.preset, 'solo-light');
  const noms = d.modules.map((m) => m.nom);
  assert.ok(noms.includes('fork-join'), 'tâches indépendantes -> fork-join');
  assert.ok(noms.includes('unites-indexees'), 'pas d\'audit fin -> unites-indexees (mémoire adressée)');
  assert.ok(noms.includes('heartbeat-log'), 'suivi demandé -> heartbeat-log');
  assert.ok(!noms.includes('instance-budget'), 'solo : pas de répartition de budget à orchestrer');
  assert.strictEqual(d.parametres.profondeur_max, 2);
  assert.strictEqual(d.parametres.format_rapport_final, 'simple');
});

test('le mode équipe bascule les modules et les plafonds', () => {
  const d = init.deriver(REPONSES_EQUIPE);
  assert.strictEqual(d.preset, 'team-standard');
  const noms = d.modules.map((m) => m.nom);
  assert.ok(noms.includes('dependency-graph'), 'dépendances déclarées -> dependency-graph');
  assert.ok(noms.includes('journal-synthesis'), 'audit fin -> journal-synthesis');
  assert.ok(noms.includes('instance-budget') && noms.includes('graveyard-handover'));
  assert.strictEqual(d.parametres.budget_instances_total, 15);
  assert.strictEqual(d.parametres.profondeur_max, 3);
});

test('exactement un module par catégorie obligatoire, quelles que soient les réponses', () => {
  for (const ampleur of ['solo', 'equipe']) {
    for (const dependances of [true, false]) {
      for (const audit of [true, false]) {
        for (const suivi of [true, false]) {
          const d = init.deriver({ ...REPONSES_SOLO, ampleur, dependances, audit, suivi });
          for (const c of CATEGORIES_OBLIGATOIRES) {
            const n = d.modules.filter((m) => m.categorie === c).length;
            assert.strictEqual(n, 1, `${c} : ${n} module(s) pour ${ampleur}/${dependances}/${audit}/${suivi}`);
          }
        }
      }
    }
  }
});

test('aucune paire de modules incompatibles ne peut être produite', () => {
  for (const ampleur of ['solo', 'equipe']) {
    for (const dependances of [true, false]) {
      for (const audit of [true, false]) {
        const noms = init.deriver({ ...REPONSES_SOLO, ampleur, dependances, audit }).modules.map((m) => m.nom);
        for (const [a, b] of INCOMPATIBLES) {
          assert.ok(!(noms.includes(a) && noms.includes(b)), `${a} + ${b} tous deux actifs`);
        }
      }
    }
  }
});

test('chaque module produit porte une justification lisible', () => {
  for (const m of init.deriver(REPONSES_EQUIPE).modules) {
    assert.ok(m.pourquoi && m.pourquoi.length > 10, `justification absente pour ${m.nom}`);
  }
});

test('OBJECTIVE.md reprend l\'énoncé et signale les critères manquants', () => {
  const avec = init.rendreObjective(REPONSES_SOLO);
  assert.ok(avec.includes('Les quatre pages sont en ligne et relues.'));
  const sans = init.rendreObjective(REPONSES_EQUIPE);
  assert.ok(sans.includes('Non précisés au setup'), 'un critère vide doit être signalé, pas masqué');
  assert.ok(sans.includes('CLARIFICATION'), 'et renvoyer au droit du KERNEL §6.1');
});

test('les réponses sont normalisées comme dans le dialogue', () => {
  const q = init.QUESTIONS.find((x) => x.cle === 'suivi');
  assert.strictEqual(init.normaliser(q, ''), true, 'défaut O appliqué sur entrée vide');
  assert.strictEqual(init.normaliser(q, 'n'), false);
  assert.strictEqual(init.normaliser(q, 'oui'), true);
  const a = init.QUESTIONS.find((x) => x.cle === 'ampleur');
  assert.strictEqual(init.normaliser(a, '2'), 'equipe');
  assert.strictEqual(init.normaliser(a, '9'), null, 'un choix hors liste est refusé, pas deviné');
  const m = init.QUESTIONS.find((x) => x.cle === 'mission');
  assert.notStrictEqual(m.valide('Refonte Site'), true, 'nom non kebab-case refusé');
  assert.strictEqual(m.valide('refonte-site'), true);
});

test('refuse d\'écraser des fichiers existants sans --force', () => {
  const dir = tmp();
  init.ecrire(REPONSES_SOLO, { out: dir });
  assert.throws(() => init.ecrire(REPONSES_SOLO, { out: dir }), /existe déjà/);
  assert.doesNotThrow(() => init.ecrire(REPONSES_SOLO, { out: dir, force: true }));
});

test('bout en bout : le CLI non interactif produit une config validée à 0 erreur par module-forge', () => {
  const dir = tmp();
  const f = path.join(dir, 'reponses.json');
  fs.writeFileSync(f, JSON.stringify(REPONSES_EQUIPE));
  const sortie = execFileSync('node', [OUTIL, '--reponses', f, '--out', dir], { encoding: 'utf8' });
  assert.ok(sortie.includes('validée par module-forge : 0 erreur'), sortie);
  assert.ok(fs.existsSync(path.join(dir, 'CONFIG.md')));
  assert.ok(fs.existsSync(path.join(dir, 'OBJECTIVE.md')));
});

test('les huit combinaisons de réponses produisent toutes une config valide', () => {
  for (const ampleur of ['solo', 'equipe']) {
    for (const dependances of [true, false]) {
      for (const audit of [true, false]) {
        const dir = tmp();
        const r = { ...REPONSES_SOLO, ampleur, dependances, audit };
        const { fConfig } = init.ecrire(r, { out: dir });
        const v = init.validerConfigProduite(fConfig, {});
        assert.ok(v.disponible, 'validateur module-forge introuvable');
        assert.deepStrictEqual(v.erreurs, [], `${ampleur}/${dependances}/${audit} : ${v.erreurs.join(' | ')}`);
      }
    }
  }
});

test('une config sciemment cassée est bien rejetée (le test précédent n\'est pas vide)', () => {
  const dir = tmp();
  const { fConfig } = init.ecrire(REPONSES_SOLO, { out: dir });
  const casse = fs.readFileSync(fConfig, 'utf8').replace('| 3 | memoire | unites-indexees |', '');
  fs.writeFileSync(fConfig, casse);
  const v = init.validerConfigProduite(fConfig, {});
  assert.ok(v.erreurs.length > 0, 'retirer une catégorie obligatoire doit produire une erreur');
});
