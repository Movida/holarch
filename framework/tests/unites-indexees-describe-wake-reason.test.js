'use strict';
// Point 4 du §2.6 : describeWakeReason — état/note de STATUS.md, messages INBOX nouveaux depuis le
// dernier commit MEMORY.md, enfants dont STATUS.md a changé depuis ce commit ; repli sans git.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { LANCEUR, makeRoot, gitInit, gitCommitAt, status } = require('./unites-indexees-setup.js');

function msg(id, type, date) {
  return `---\nid: ${id}\nfrom: x\nto: concepteur\ntype: ${type}\nref: —\ndate: ${date}\n---\ncorps de ${id}.\n`;
}

test('describeWakeReason : sans dépôt git → bloc réduit à l\'état de STATUS.md', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), status('WORKING', 'en cours'));
  const r = LANCEUR.describeWakeReason(root, 'concepteur');
  assert.match(r, /état : WORKING — en cours/);
  assert.match(r, /sans Git/);
});

test('describeWakeReason : messages INBOX nouveaux et enfant dont STATUS.md a changé, depuis le dernier commit MEMORY', () => {
  const root = makeRoot();
  const env = gitInit(root);
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), status('WAITING_CHILDREN', 'attend enfant'));
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), `# Boîte\n\n${msg('MSG-1', 'TASK', '2026-09-01T00:00:00Z')}`);
  // Commit qui touche MEMORY.md : « dernière hibernation ».
  gitCommitAt(root, env, '2026-09-02T00:00:00Z', '[concepteur] hibernation de test');
  // Après ce commit : un nouveau message INBOX, et le STATUS.md de l'enfant qui change.
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), `# Boîte\n\n${msg('MSG-1', 'TASK', '2026-09-01T00:00:00Z')}\n${msg('MSG-2', 'DELIVERABLE', '2026-09-03T00:00:00Z')}`);
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'enfant', 'STATUS.md'), status('DELIVERED', 'fini'));
  gitCommitAt(root, env, '2026-09-03T01:00:00Z', '[concepteur/enfant] livraison de test');
  const r = LANCEUR.describeWakeReason(root, 'concepteur');
  assert.match(r, /état : WAITING_CHILDREN — attend enfant/);
  const ligneMessages = r.split('\n').find((l) => l.startsWith('messages INBOX nouveaux'));
  assert.equal(ligneMessages.includes('MSG-2'), true);
  assert.equal(ligneMessages.includes('MSG-1'), false); // MSG-1 est antérieur au commit MEMORY, exclu
  assert.match(r, /enfant → DELIVERED/);
});
