'use strict';
// Mesures avant/après du prompt utilisateur (§2.7 de docs/IMPLEMENTATION.md, chantier 1), reproductibles :
//   node framework/tests/unites-indexees-mesures.js
// (gardées en non-régression par unites-indexees-mesures.test.js). Deux mesures, contre le lanceur réel :
//   (a) corpus archivé docs/archive/mission-holon-v2/concepteur/ (module monolithic) : < 60 000 car.
//   (b) fixture développeur (module unites-indexees, MEMORY 60 lignes, 20 fiches, INBOX 48 messages
//       dont 3 non traités) : < 40 000 caractères.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DEPOT = path.resolve(__dirname, '..', '..');
const CIBLE = path.resolve(__dirname, '..');
const LANCEUR = require(path.join(CIBLE, 'bin', 'holarch-spawn.js'));

function w(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function ficheMinimale(chemin, profil) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | x |\n| Statut | WORKING |\n| Budget alloué / consommé | 3 / 0 |\n| Dépend de | — |\n| Profil | ${profil} |\n| Livrables | — |\n| Créée / Archivée | 2026-09-02T00:00:00Z / — |\n`;
}

// ---------------------------------------------------------------------------
// (a) corpus archivé — module monolithic (chantier 0, pas de régression)
// ---------------------------------------------------------------------------
function mesureCorpusArchive() {
  const corpus = path.join(ROOT_DEPOT, 'docs', 'archive', 'mission-holon-v2', 'concepteur');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-mesure-a-'));
  w(root, 'framework/CONFIG.md', [
    '# Configuration — mission : mesure-a',
    '> Preset de base : solo-light · Framework : v1.1',
    '',
    '## Modules actifs',
    '| # | Catégorie | Module |',
    '|---|---|---|',
    '| 1 | orchestration | direct-spawn |',
    '| 2 | synchronisation | fork-join |',
    '| 3 | memoire | monolithic |',
    '| 4 | recursion | max-depth |',
    '| 5 | registre | sharded-files |',
    '',
    '## Paramètres',
    '| Paramètre | Valeur |',
    '|---|---|',
    '| budget_instances_total | 8 |',
    '| profondeur_max | 2 |',
    '| permission_mode | acceptEdits |',
    '| format_rapport_final | simple |',
    '| max_tours_par_session | 200 |',
    '| budget_usd_par_session | 5 |',
    '| seuil_contexte_tokens | 120000 |',
    '| changements_regime_max | 1 |',
    '',
    '## Politique de modèle',
    '| Profil | Modèle | Effort |',
    '|---|---|---|',
    '| conception | opus | high |',
    '',
  ].join('\n'));
  for (const name of ['ROLE.md', 'MEMORY.md', 'STATUS.md', 'INBOX.md', 'JOURNAL.md']) {
    const src = path.join(corpus, name);
    if (fs.existsSync(src)) w(root, `mission/concepteur/${name}`, fs.readFileSync(src, 'utf8'));
  }
  w(root, 'mission/registry/PROGRESS.md', '# Avancement\n2026-09-02T00:00:00Z · concepteur · ON_ORIENT · plan\n');
  const launch = LANCEUR.prepareLaunch(root, 'concepteur', {});
  return { root, chars: launch.prompt.length, blocs: launch.blocs };
}

// ---------------------------------------------------------------------------
// (b) fixture développeur — module unites-indexees
// ---------------------------------------------------------------------------
function ficheUnite(n, { date, critere, resultat = 'PASS', preuve, commit = '—' }) {
  return [
    '---',
    `id: U${n}`,
    `date: ${date}`,
    `critere: ${critere}`,
    `resultat: ${resultat}`,
    `preuve: ${preuve}`,
    `commit: ${commit}`,
    'tags: —',
    '---',
    '## Ce qui a été fait',
    `Unité U${n} de la fixture de mesure, corps minimal pour la fiche.`,
    '',
    '## Ce qui reste ouvert',
    'rien',
    '',
    '## Pièges rencontrés',
    'aucun',
    '',
  ].join('\n');
}

function memoryFixture60Lignes() {
  const lignes = [
    '# Mémoire — fixture',
    '> Dernière mise à jour : 2026-09-10 · Session n° 20',
    '',
    '## État courant',
  ];
  for (let i = 1; i <= 12; i++) lignes.push(`Ligne d'état courant n°${i} de la fixture de mesure.`);
  lignes.push('', '## Décisions prises');
  for (let i = 1; i <= 20; i++) lignes.push(`${i}. Décision n°${i} de la fixture. → memoire/U${i}-fixture.md`);
  lignes.push('', '## Prochaines actions');
  for (let i = 1; i <= 15; i++) lignes.push(`${i}. Action n°${i} à mener.`);
  lignes.push('', '## Points de vigilance');
  for (let i = 1; i <= 6; i++) lignes.push(`Point de vigilance n°${i}.`);
  while (lignes.length < 60) lignes.push('.');
  return lignes.slice(0, 60).join('\n') + '\n';
}

function mesureFixtureDev() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-mesure-b-'));
  w(root, 'framework/CONFIG.md', [
    '# Configuration — mission : mesure-b',
    '> Preset de base : solo-light · Framework : v1.1',
    '',
    '## Modules actifs',
    '| # | Catégorie | Module |',
    '|---|---|---|',
    '| 1 | orchestration | direct-spawn |',
    '| 2 | synchronisation | fork-join |',
    '| 3 | memoire | unites-indexees |',
    '| 4 | recursion | max-depth |',
    '| 5 | registre | sharded-files |',
    '',
    '## Paramètres',
    '| Paramètre | Valeur |',
    '|---|---|',
    '| budget_instances_total | 8 |',
    '| profondeur_max | 2 |',
    '| permission_mode | acceptEdits |',
    '| format_rapport_final | simple |',
    '| max_tours_par_session | 200 |',
    '| budget_usd_par_session | 5 |',
    '| seuil_contexte_tokens | 120000 |',
    '| changements_regime_max | 1 |',
    '',
    '## Politique de modèle',
    '| Profil | Modèle | Effort |',
    '|---|---|---|',
    '| execution | sonnet | medium |',
    '',
  ].join('\n'));
  w(root, 'mission/concepteur/ROLE.md', '# Rôle : concepteur\nMission racine de la fixture de mesure.\n');
  w(root, 'mission/concepteur/MEMORY.md', memoryFixture60Lignes());
  w(root, 'mission/concepteur/STATUS.md', '# Statut — concepteur\n\n| Champ | Valeur |\n|---|---|\n| État | WORKING |\n| Depuis | 2026-09-10T00:00:00Z |\n| Posé par | soi |\n| Note | fixture de mesure U7 |\n');
  w(root, 'mission/registry/instances/concepteur.md', ficheMinimale('concepteur', 'execution'));

  // 20 fiches d'unité (memoire/U1..U20)
  for (let i = 1; i <= 20; i++) {
    w(root, `mission/concepteur/memoire/U${i}-fixture.md`, ficheUnite(i, {
      date: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T0${i % 10}:00:00Z`,
      critere: `Critère vérifiable de l'unité U${i} de la fixture, tronqué au besoin à 90 caractères pour l'index régénéré.`,
      preuve: `tests/U${i}.test.js`,
    }));
  }

  // INBOX de 48 messages, dont 3 « non traités » (les 2 derniers + un TASK sans ref dans OUTBOX).
  const messages = [];
  for (let i = 1; i <= 45; i++) {
    messages.push([
      '---',
      `id: MSG-fixture-${String(i).padStart(3, '0')}`,
      'from: concepteur-parent',
      'to: concepteur',
      i % 5 === 0 ? 'type: PROPOSAL' : 'type: RESPONSE',
      `ref: MSG-fixture-${String(Math.max(1, i - 1)).padStart(3, '0')}`,
      `date: 2026-08-${String(1 + (i % 28)).padStart(2, '0')}`,
      '---',
      `Corps du message ${i} de la fixture, traité (répondu dans OUTBOX.md).`,
      '',
    ].join('\n'));
  }
  // Message 46 : TASK sans ref, jamais répondu dans OUTBOX (non traité, critère c).
  messages.push([
    '---',
    'id: MSG-fixture-046',
    'from: concepteur-parent',
    'to: concepteur',
    'type: TASK',
    'ref: —',
    'date: 2026-09-09',
    '---',
    'Tâche 46 de la fixture, sans réponse dans OUTBOX.md (non traité).',
    '',
  ].join('\n'));
  // Messages 47 et 48 : les deux derniers du fichier (non traités par le critère b : 2 derniers).
  for (let i = 47; i <= 48; i++) {
    messages.push([
      '---',
      `id: MSG-fixture-${String(i).padStart(3, '0')}`,
      'from: concepteur-parent',
      'to: concepteur',
      'type: RESPONSE',
      `ref: MSG-fixture-${String(i - 1).padStart(3, '0')}`,
      `date: 2026-09-1${i - 47}`,
      '---',
      `Corps du message ${i} de la fixture, dernier(s) du fichier.`,
      '',
    ].join('\n'));
  }
  const outbox = '# OUTBOX — concepteur\n\n' + Array.from({ length: 45 }, (_, k) => {
    const i = k + 1;
    return [
      '---',
      `id: MSG-fixture-out-${String(i).padStart(3, '0')}`,
      'from: concepteur',
      'to: concepteur-parent',
      'type: RESPONSE',
      `ref: MSG-fixture-${String(i).padStart(3, '0')}`,
      `date: 2026-08-${String(1 + (i % 28)).padStart(2, '0')}`,
      '---',
      `Réponse au message ${i}.`,
      '',
    ].join('\n');
  }).join('\n');
  w(root, 'mission/concepteur/OUTBOX.md', outbox);

  // Git : 45 premiers messages + fiches + MEMORY.md committés comme « avant la dernière
  // hibernation » (2026-09-08), puis les 3 derniers messages (46 TASK sans ref, 47 et 48, les deux
  // derniers du fichier) ajoutés à l'INBOX seule après ce commit — sans toucher MEMORY.md — pour
  // que `lastHibernationCommit`/`selectInboxMessages` les détectent réellement comme non traités
  // (critères a et b), au lieu d'un simple repli sans Git.
  const { spawnSync } = require('child_process');
  const env = Object.assign({}, process.env, {
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@test',
  });
  w(root, 'mission/concepteur/INBOX.md', '# INBOX — concepteur\n\n' + messages.slice(0, 45).join('\n'));
  spawnSync('git', ['-C', root, 'init', '-q'], { env });
  spawnSync('git', ['-C', root, 'config', 'user.email', 't@test'], { env });
  spawnSync('git', ['-C', root, 'config', 'user.name', 'Test'], { env });
  spawnSync('git', ['-C', root, 'add', '-A'], { env });
  spawnSync('git', ['-C', root, 'commit', '-q', '-m', '[concepteur] hibernation (fixture)'], {
    env: Object.assign({}, env, { GIT_AUTHOR_DATE: '2026-09-08T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-08T00:00:00Z' }),
  });
  w(root, 'mission/concepteur/INBOX.md', '# INBOX — concepteur\n\n' + messages.join('\n'));
  spawnSync('git', ['-C', root, 'add', '-A'], { env });
  spawnSync('git', ['-C', root, 'commit', '-q', '-m', '[concepteur] 3 messages reçus'], {
    env: Object.assign({}, env, { GIT_AUTHOR_DATE: '2026-09-09T12:00:00Z', GIT_COMMITTER_DATE: '2026-09-09T12:00:00Z' }),
  });

  const launch = LANCEUR.prepareLaunch(root, 'concepteur', {});
  return { root, chars: launch.prompt.length, blocs: launch.blocs };
}

function main() {
  const a = mesureCorpusArchive();
  const b = mesureFixtureDev();
  const fmt = (r) => r.blocs.map((x) => `${x.nom} ${x.chars}${x.note ? ` (${x.note})` : ''}`).join(' · ');
  process.stdout.write(`(a) corpus archivé (module monolithic) : ${a.chars} caractères — seuil < 60000\n`);
  process.stdout.write(`    blocs : ${fmt(a)}\n`);
  process.stdout.write(`(b) fixture développeur (module unites-indexees) : ${b.chars} caractères — seuil < 40000\n`);
  process.stdout.write(`    blocs : ${fmt(b)}\n`);
  const ok = a.chars < 60000 && b.chars < 40000;
  process.stdout.write(ok ? 'RESULTAT : conforme\n' : 'RESULTAT : NON CONFORME\n');
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { mesureCorpusArchive, mesureFixtureDev };
