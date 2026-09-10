'use strict';
// Point 3 du §2.6 : selectInboxMessages — (a) messages postérieurs au dernier commit MEMORY,
// (b) deux derniers, (c) TASK sans ref dans OUTBOX ; repli sans git.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { LANCEUR, makeRoot, gitInit, gitCommitAt } = require('./unites-indexees-setup.js');

function msg(id, type, date, ref) {
  return `---\nid: ${id}\nfrom: x\nto: concepteur\ntype: ${type}\nref: ${ref || '—'}\ndate: ${date}\n---\ncorps de ${id}.\n`;
}

test('selectInboxMessages : sans dépôt git → repli sur tailInboxBounded seul', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), `# Boîte\n\n${msg('MSG-1', 'TASK', '2026-09-01T00:00:00Z')}`);
  const r = LANCEUR.selectInboxMessages(root, 'concepteur', LANCEUR.DEFAULTS);
  assert.match(r.criteres, /repli sans git/);
  assert.ok(r.content.includes('MSG-1'));
});

test('selectInboxMessages : (a) postérieurs au dernier commit MEMORY, (b) 2 derniers, (c) TASK/RESPONSE sans ref dans OUTBOX', () => {
  const root = makeRoot();
  const env = gitInit(root);
  // Six messages : trois avant le commit MEMORY, trois après.
  const inbox = [
    msg('MSG-1', 'DELIVERABLE', '2026-09-01T00:00:00Z'), // avant, traité (a une ref dans OUTBOX), pas dans les 2 derniers
    msg('MSG-2', 'TASK', '2026-09-01T01:00:00Z'), // avant, TASK SANS ref dans OUTBOX → (c) doit être sélectionné
    msg('MSG-3', 'TASK', '2026-09-01T02:00:00Z', '—'), // avant, TASK sans ref → (c)
    msg('MSG-4', 'CLARIFICATION', '2026-09-03T00:00:00Z'), // après le commit MEMORY → (a)
    msg('MSG-5', 'RESPONSE', '2026-09-03T01:00:00Z'), // après + 2 derniers
    msg('MSG-6', 'TASK', '2026-09-03T02:00:00Z'), // après + 2 derniers
  ].join('\n');
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), `# Boîte\n\n${inbox}`);
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'OUTBOX.md'), '# Boîte sortie\n\n---\nid: MSG-OUT-1\nfrom: concepteur\nto: x\ntype: RESPONSE\nref: MSG-1\ndate: 2026-09-01T00:30:00Z\n---\ntraité.\n');
  // Commit qui touche MEMORY.md, daté entre MSG-3 et MSG-4 : "dernière hibernation".
  gitCommitAt(root, env, '2026-09-02T00:00:00Z', '[concepteur] hibernation de test');
  const r = LANCEUR.selectInboxMessages(root, 'concepteur', LANCEUR.DEFAULTS);
  assert.match(r.content, /MSG-2/); // (c) TASK sans ref
  assert.match(r.content, /MSG-3/); // (c) TASK sans ref
  assert.match(r.content, /MSG-4/); // (a) postérieur au commit
  assert.match(r.content, /MSG-5/); // (b) 2 derniers
  assert.match(r.content, /MSG-6/); // (a) + (b)
  assert.doesNotMatch(r.content, /MSG-1\n/); // traité (ref dans OUTBOX), antérieur, pas dans les 2 derniers → exclu
});
