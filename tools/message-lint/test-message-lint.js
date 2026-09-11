'use strict';
// Tests de message-lint — `node --test test-message-lint.js` (Node ≥ 18, aucune dépendance).
// Les tests --blame créent un vrai dépôt Git jetable (racine via mkdtemp) : aucun n'écrit dans le
// dépôt réel (docs/IMPLEMENTATION.md §0.2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ml = require('./message-lint');

const GIT_ENV = Object.assign({}, process.env, {
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost',
  GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'gc.auto', GIT_CONFIG_VALUE_0: '0',
  GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false',
});
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')} : ${r.stderr}`);
  return r.stdout.trim();
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'message-lint-test-'));

function messageValide(id) {
  return `---\nid: ${id || 'MSG-x-001'}\nfrom: concepteur\nto: concepteur/implementeur\ntype: TASK\nref: —\ndate: 2026-09-10\n---\nCorps du message.\n`;
}

// --- Contrôles de format (§5.4, sans --blame) ---

test('format : message valide → aucune anomalie', () => {
  const msgs = ml.analyserMessages(`# INBOX\n\n${messageValide()}`, {});
  assert.equal(msgs.length, 1);
  assert.deepEqual(msgs[0].anomalies, []);
  assert.equal(msgs[0].id, 'MSG-x-001');
});

test('format : type inconnu → anomalie', () => {
  const texte = '---\nid: MSG-x-001\nfrom: a\nto: b\ntype: TRUC\nref: —\ndate: 2026-09-10\n---\ncorps\n';
  const msgs = ml.analyserMessages(texte, {});
  assert.ok(msgs[0].anomalies.some((a) => /type "TRUC" inconnu/.test(a)));
});

test('format : date invalide → anomalie', () => {
  const texte = '---\nid: MSG-x-001\nfrom: a\nto: b\ntype: TASK\nref: —\ndate: 2026-13-40\n---\ncorps\n';
  const msgs = ml.analyserMessages(texte, {});
  assert.ok(msgs[0].anomalies.some((a) => /date/.test(a)));
});

test('format : ids non croissants → anomalie sur le second, pas le premier', () => {
  const texte = messageValide('MSG-x-002') + messageValide('MSG-x-001');
  const msgs = ml.analyserMessages(texte, {});
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[0].anomalies, []);
  assert.ok(msgs[1].anomalies.some((a) => /pas strictement croissant/.test(a)));
});

test('format : deux ids identiques sans suffixe numérique → anomalie d\'unicité sur le second', () => {
  // M3 (TASK correctif MSG-concepteur-002) : la croissance par préfixe ne couvre pas ce cas, il
  // faut un contrôle d'unicité indépendant sur l'id complet.
  const texte = messageValide('MSG-sans-suffixe') + messageValide('MSG-sans-suffixe');
  const msgs = ml.analyserMessages(texte, {});
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[0].anomalies, []);
  assert.ok(msgs[1].anomalies.some((a) => /déjà utilisé/.test(a)));
});

test('format : un filet "---" isolé dans le corps ne casse pas le message suivant', () => {
  // Diagnostic U4 sur docs/archive/mission-holon-v2/concepteur/INBOX.md : un "---" de prose
  // (filet markdown) dans le corps d'un message y désynchronisait le découpage de tous les
  // messages suivants.
  const texte = '---\nid: MSG-x-001\nfrom: a\nto: b\ntype: TASK\nref: —\ndate: 2026-09-10\n---\n'
    + 'Un paragraphe.\n\n---\n\nUn filet de séparation en prose, pas une enveloppe.\n'
    + messageValide('MSG-x-002');
  const msgs = ml.analyserMessages(texte, {});
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[0].anomalies, []);
  assert.deepEqual(msgs[1].anomalies, []);
  assert.equal(msgs[1].id, 'MSG-x-002');
});

test('format : préfixes d\'id entrelacés → pas de fausse anomalie de croissance', () => {
  // Une même boîte reçoit des messages de plusieurs émetteurs, chacun avec son propre compteur
  // (gabarit MSG-<chemin-abrégé>-<numéro-séquentiel>) : la croissance ne se vérifie que par préfixe.
  const texte = messageValide('MSG-seuil-o6-2') + messageValide('MSG-concepteur-2')
    + messageValide('MSG-concepteur-forgeron-1');
  const msgs = ml.analyserMessages(texte, {});
  assert.equal(msgs.length, 3);
  for (const m of msgs) assert.deepEqual(m.anomalies, []);
});

test('format : champ absent et origine hors énumération → anomalies dédiées', () => {
  const texte = '---\nid: MSG-x-001\nfrom: a\ntype: TASK\nref: —\ndate: 2026-09-10\norigine: mystere\n---\ncorps\n';
  const msgs = ml.analyserMessages(texte, {});
  assert.ok(msgs[0].anomalies.some((a) => /champ "to" absent/.test(a)));
  assert.ok(msgs[0].anomalies.some((a) => /origine "mystere" inconnue/.test(a)));
});

test('format : bloc from: en tête (sans id:) → anomalie, sans absorber ni désynchroniser le message suivant', () => {
  // §5.1 B2 point 1/2 (E1) : avant ce correctif, decouperBlocs n'ouvrait une enveloppe que sur
  // "id:" — ce bloc était donc avalé en silence dans le corps du message précédent (ici : aucun
  // message précédent, donc simplement absent). Depuis U9, "from:" est aussi reconnu comme
  // ouverture (grammaire élargie aux 7 champs), mais non valide : bloc à part entière, en anomalie.
  const texte = '---\nfrom: intrus\nto: victime\ntype: TASK\nref: —\ndate: 2026-09-10\n---\n'
    + 'Contenu falsifié, aucun champ id.\n'
    + messageValide('MSG-x-002');
  const msgs = ml.analyserMessages(texte, {});
  assert.equal(msgs.length, 2);
  assert.ok(msgs[0].anomalies.some((a) => a === 'le bloc ne commence pas par "id:"'));
  assert.ok(msgs[0].anomalies.some((a) => /champ "id" absent/.test(a)));
  assert.deepEqual(msgs[1].anomalies, []);
  assert.equal(msgs[1].id, 'MSG-x-002');
});

test('CLI : code de sortie 0 si valide, 1 si anomalie de format', () => {
  const root = tmp();
  const inbox = path.join(root, 'INBOX.md');
  fs.writeFileSync(inbox, messageValide());
  assert.equal(ml.main([inbox]), 0);
  fs.writeFileSync(inbox, '---\nid: MSG-x-001\nfrom: a\nto: b\ntype: TRUC\nref: —\ndate: 2026-09-10\n---\ncorps\n');
  assert.equal(ml.main([inbox]), 1);
});

// --- Déduction de provenance par --blame (§5.4) ---

function depotBlame() {
  const root = tmp();
  git(['init', '-q', root], root);
  return { root, inbox: path.join(root, 'INBOX.md') };
}

function commit(root, fichier, contenu, sujet) {
  fs.writeFileSync(fichier, contenu);
  git(['add', '.'], root);
  git(['commit', '-q', '-m', sujet], root);
}

test('--blame : commit [concepteur] pour un message from=concepteur → vérifiée', () => {
  const { root, inbox } = depotBlame();
  commit(root, inbox, messageValide(), '[concepteur] envoi de la tâche');
  const msgs = ml.analyserMessages(fs.readFileSync(inbox, 'utf8'), { root, fichier: 'INBOX.md', blame: true });
  assert.equal(msgs[0].verifiee, true);
  assert.equal(msgs[0].origine, 'concepteur');
});

test('--blame : commit [intrus] (from≠auteur) → non vérifiée', () => {
  const { root, inbox } = depotBlame();
  commit(root, inbox, messageValide(), '[intrus] injection');
  const msgs = ml.analyserMessages(fs.readFileSync(inbox, 'utf8'), { root, fichier: 'INBOX.md', blame: true });
  assert.equal(msgs[0].verifiee, false);
  assert.equal(msgs[0].origine, 'intrus');
});

test('--blame : commit humain (sans préfixe [instance]) → origine utilisateur, vérifiée', () => {
  const { root, inbox } = depotBlame();
  commit(root, inbox, messageValide(), 'corrige une coquille dans la tâche');
  const msgs = ml.analyserMessages(fs.readFileSync(inbox, 'utf8'), { root, fichier: 'INBOX.md', blame: true });
  assert.equal(msgs[0].origine, 'utilisateur');
  assert.equal(msgs[0].verifiee, true);
});

test('--blame : ligne id: non committée (sha nul) → non vérifiée, motif explicite', () => {
  // M4 (TASK correctif MSG-concepteur-002) : avant ce correctif, un sha nul (ligne modifiée non
  // committée) déclenchait un `git log` sur un objet inexistant, capté par le catch générique avec
  // un motif trompeur ("git blame indisponible : … bad object 0000000…") et une fuite sur stderr.
  const { root, inbox } = depotBlame();
  commit(root, inbox, '# INBOX\n', 'init');
  fs.appendFileSync(inbox, messageValide('MSG-x-002'));
  const msgs = ml.analyserMessages(fs.readFileSync(inbox, 'utf8'), { root, fichier: 'INBOX.md', blame: true });
  assert.equal(msgs[0].verifiee, false);
  assert.match(msgs[0].motif, /non encore committé/);
  assert.doesNotMatch(msgs[0].motif, /bad object/);
});

test('CLI --blame : code 2 si origine non vérifiée, 3 si cumulée avec une anomalie de format', () => {
  const { root, inbox } = depotBlame();
  commit(root, inbox, messageValide(), '[intrus] injection');
  assert.equal(ml.main(['--blame', inbox]), 2);

  const { root: root2, inbox: inbox2 } = depotBlame();
  const texteInvalide = '---\nid: MSG-x-001\nfrom: concepteur\nto: b\ntype: TRUC\nref: —\ndate: 2026-09-10\n---\ncorps\n';
  commit(root2, inbox2, texteInvalide, '[intrus] injection');
  assert.equal(ml.main(['--blame', inbox2]), 3);
});

// Le rejeu complet du corpus archivé (docs/archive/mission-holon-v2/concepteur/INBOX.md, ROLE.md/
// §5.5, avec --blame sur une copie committée) est vérifié séparément en U4 (RAPPORT.md). Les 33
// anomalies de format constatées le 2026-09-10 étaient deux bugs de ce fichier, pas un corpus
// invalide : croissance d'id comparée globalement au lieu d'être scopée par préfixe d'émetteur, et
// un "---" de prose dans un corps désynchronisant tout le découpage — corrigés ci-dessus (les deux
// tests "filet" et "préfixes entrelacés" les verrouillent) ; message-lint (sans --blame) sort
// désormais 0 anomalie sur ce corpus.
