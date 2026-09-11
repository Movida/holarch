'use strict';
// 1.13.1 : --arret constate d'abord si une session vit ; --immediat tue l'arbre de processus.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const launcher = require(path.join(__dirname, '..', 'bin', 'holarch-spawn.js'));

function root() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-arret-'));
  fs.mkdirSync(path.join(r, 'mission', '.holarch', 'live'), { recursive: true });
  return r;
}
const lock = (r, pid) => fs.writeFileSync(path.join(r, 'mission', '.holarch', 'live', 'concepteur.json'), JSON.stringify({ pid, startedAt: 'x', attempt: 1 }));
const vivant = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };

test('--arret sans session vivante : rien à arrêter, verrou périmé nettoyé, aucun fichier stop', () => {
  const r = root();
  lock(r, 999999999);
  const res = launcher.demanderArret(r, 'concepteur', {});
  assert.equal(res.vivant, false);
  assert.match(res.message, /aucune session vivante/);
  assert.equal(fs.existsSync(path.join(r, 'mission', '.holarch', 'live', 'concepteur.json')), false);
  assert.equal(fs.existsSync(path.join(r, 'mission', '.holarch', 'stop', 'concepteur')), false);
});

test('--arret propre sur une session vivante : fichier stop écrit, processus intact', () => {
  const r = root();
  const p = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    lock(r, p.pid);
    const res = launcher.demanderArret(r, 'concepteur', {});
    assert.equal(res.mode, 'propre');
    assert.equal(fs.existsSync(path.join(r, 'mission', '.holarch', 'stop', 'concepteur')), true);
    assert.equal(vivant(p.pid), true);
  } finally { try { p.kill('SIGKILL'); } catch (_) { /* déjà mort */ } }
});

test('--arret --immediat : l\'arbre de processus est tué (enfant puis lanceur), verrou retiré', async () => {
  const r = root();
  // « lanceur » = un shell qui lance un enfant sleep, comme holarch-spawn lance claude
  const p = spawn('bash', ['-c', 'sleep 30 & wait'], { stdio: 'ignore' });
  await new Promise((res) => setTimeout(res, 300));
  const enfants = launcher.descendants(p.pid);
  assert.ok(enfants.length >= 1, 'un enfant sleep attendu');
  lock(r, p.pid);
  const res = launcher.demanderArret(r, 'concepteur', { immediat: true, attenteMs: 2000 });
  assert.equal(res.mode, 'immediat');
  await new Promise((res2) => setTimeout(res2, 300));
  assert.equal(vivant(p.pid), false, 'lanceur encore vivant');
  for (const c of enfants) assert.equal(vivant(c), false, `enfant ${c} encore vivant`);
  assert.equal(fs.existsSync(path.join(r, 'mission', '.holarch', 'live', 'concepteur.json')), false);
});
