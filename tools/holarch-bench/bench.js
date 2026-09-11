#!/usr/bin/env node
'use strict';
/**
 * bench.js — banc de mesure à deux étages (chantier 5, docs/IMPLEMENTATION.md §6.2).
 *
 *   node bench.js --a-sec                          rejoue les 7 scénarios (framework/tests/scenarios/), 0 USD
 *   node bench.js --reel <mission> --budget-usd N   copie docs/examples/<mission> dans une racine jetable, --bootstrap
 *   node bench.js --calibrer <SESSIONS.md>          médiane/p90 : coût, contexte, tours, hibernations — n'écrit jamais CONFIG.md
 *   node bench.js --calibrer --transcriptions <d>   même calibrage, reconstitué depuis un dossier de transcriptions *.jsonl
 *
 * Installé (par appliquer.js) à tools/holarch-bench/bench.js dans le dépôt réel.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Parsing générique d'un tableau markdown (par nom de colonne, jamais par position :
// le format de SESSIONS.md a changé entre missions archivées — 10 colonnes pour
// holon-v2, 11 pour fondations/isolation/provenance, colonne « Réveil » en plus —
// voir memoire/U1-orientation-seam-formats.md de cette instance).
// ---------------------------------------------------------------------------
function parseSessionsMd(text) {
  const lignes = String(text || '').split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lignes.length - 1; i++) {
    if (/^\|.*\|\s*$/.test(lignes[i]) && /^\|[\s:|-]*-{3,}[\s:|-]*\|\s*$/.test(lignes[i + 1])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { headers: [], rows: [] };
  const headers = lignes[headerIdx].split('|').slice(1, -1).map((c) => c.trim());
  const rows = [];
  for (let i = headerIdx + 2; i < lignes.length; i++) {
    const l = lignes[i];
    if (!/^\|.*\|\s*$/.test(l)) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cells[idx]; });
    rows.push(row);
  }
  return { headers, rows };
}

function findCol(headers, motifs) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (motifs.some((m) => h.includes(m))) return headers[i];
  }
  return null;
}

function parseNumberCell(v) {
  if (v === undefined) return null;
  const t = String(v).trim();
  if (t === '' || t === '?' || t === '—') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// « Tokens (entrée / cache lu / cache écrit / sortie) » → entrée + cache lu + cache écrit,
// exactement la formule du hook context-watch (framework/hooks/holarch-hooks.js, contextWatch :
// tokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
// sortie explicitement exclue). Choisi pour que « seuil_contexte_tokens » se calibre sur la même
// grandeur que celle que le hook surveille réellement, pas sur un proxy inventé pour ce banc.
function parseTokensCell(v) {
  if (v === undefined) return null;
  const t = String(v).trim();
  if (t === '' || t === '—') return null;
  const parts = t.split('/').map((p) => Number(p.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  return parts[0] + parts[1] + parts[2];
}

// « Réveil (car. système / utilisateur) » : caractères du prompt injecté au réveil (promptChars,
// appendSessionLine). Grandeur distincte des tokens ci-dessus (mesurée au lancement, pas en cours de
// session) — absente du format à dix colonnes (holon-v2) : rester tolérant à son absence.
function parseReveilCell(v) {
  if (v === undefined) return null;
  const t = String(v).trim();
  if (t === '' || t === '—') return null;
  const parts = t.split('/').map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts[0] + parts[1];
}

// « Contexte (départ / max) » (chantier 6, mesure instantanée context-watch) : contexte au premier et
// au plus haut tour observés pendant la session — distinct de parseReveilCell (caractères du prompt au
// lancement) et de parseTokensCell (cumul de tokens facturés) : ici c'est l'instantané que borne
// seuil_contexte_tokens.
function parseContexteInstantCell(v) {
  if (v === undefined) return null;
  const t = String(v).trim();
  if (t === '' || t === '—' || t === '— / —') return null;
  const parts = t.split('/').map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return { depart: parts[0], max: parts[1] };
}

function median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function p90(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(0.9 * s.length) - 1));
  return s[idx];
}

// ---------------------------------------------------------------------------
// --calibrer
// ---------------------------------------------------------------------------
// bench.js n'a pas accès à CONFIG.md depuis --calibrer (doit rester utilisable sans mission, y
// compris sur de simples transcriptions hors de tout dépôt) : sert de dénominateur fixe à
// part_contexte_fixe, plutôt qu'une lecture de mission/framework/CONFIG.md.
const SEUIL_CONTEXTE_TOKENS_DEFAUT = 120000;

function calibrer(text) {
  const { headers, rows } = parseSessionsMd(text);
  const colCout = findCol(headers, ['coût', 'cout']);
  const colTours = findCol(headers, ['tours']);
  const colTokens = findCol(headers, ['tokens']);
  const colInstance = findCol(headers, ['instance']);
  const colReveil = findCol(headers, ['réveil', 'reveil']);
  const colContexteInstant = findCol(headers, ['contexte (départ', 'contexte (depart']);

  const couts = colCout ? rows.map((r) => parseNumberCell(r[colCout])).filter((n) => n !== null) : [];
  const tours = colTours ? rows.map((r) => parseNumberCell(r[colTours])).filter((n) => n !== null) : [];
  const tokens = colTokens ? rows.map((r) => parseTokensCell(r[colTokens])).filter((n) => n !== null) : [];
  const reveilChars = colReveil ? rows.map((r) => parseReveilCell(r[colReveil])).filter((n) => n !== null) : [];
  const contexteInstant = colContexteInstant
    ? rows.map((r) => parseContexteInstantCell(r[colContexteInstant])).filter((c) => c !== null)
    : [];
  const departs = contexteInstant.map((c) => c.depart);
  const maxs = contexteInstant.map((c) => c.max);

  // Hibernation = session supplémentaire d'une même Instance dans ce fichier (regroupement par valeur
  // de colonne Instance, pas par contiguïté : deux instances peuvent s'entrelacer dans le temps).
  // Ce n'est qu'un décompte à partir de SESSIONS.md seul — ne distingue pas hibernation de contexte,
  // changement de régime ou reprise après crash (tous ré-incarnent une même Instance) ; voir README.
  const parInstance = new Map();
  if (colInstance) {
    for (const r of rows) {
      const inst = r[colInstance];
      if (!inst) continue;
      parInstance.set(inst, (parInstance.get(inst) || 0) + 1);
    }
  }
  const totalHibernations = [...parInstance.values()].reduce((a, n) => a + Math.max(0, n - 1), 0);
  const hibernationsParSession = rows.length ? totalHibernations / rows.length : null;

  // seuil_contexte_tokens se calibre en priorité sur le p90 du contexte MAX instantané (mesure en
  // cours de session, context-watch) ; à défaut de colonne 12 (missions/archives antérieures au
  // chantier 6), repli sur le p90 des tokens cumulés — comportement inchangé, non-régression.
  const seuilContexteTokens = maxs.length
    ? Math.ceil(p90(maxs) / 5000) * 5000
    : (tokens.length ? Math.ceil(p90(tokens) / 5000) * 5000 : null);
  const partContexteFixe = departs.length ? median(departs) / SEUIL_CONTEXTE_TOKENS_DEFAUT : null;

  return {
    fichier: {
      nSessions: rows.length,
      nInstances: parInstance.size,
      colonnes: headers,
      reveilPresent: !!colReveil,
      contexteInstantPresent: !!colContexteInstant,
    },
    stats: {
      coutUSD: { mediane: median(couts), p90: p90(couts), n: couts.length },
      tours: { mediane: median(tours), p90: p90(tours), n: tours.length },
      contexteTokens: { mediane: median(tokens), p90: p90(tokens), n: tokens.length },
      reveilCaracteres: { mediane: median(reveilChars), p90: p90(reveilChars), n: reveilChars.length },
      contexteInstantane: contexteInstant.length
        ? { departMediane: median(departs), maxMediane: median(maxs), maxP90: p90(maxs), n: contexteInstant.length }
        : null,
      hibernationsParSession,
      totalHibernations,
    },
    propositions: {
      // p90 du coût observé, marge de 20 % arrondie au dixième supérieur — décision d'implémentation
      // (ROLE.md, Autorité : « choix des statistiques d'implémentation »), pas un seuil tranché.
      budget_usd_par_session: p90(couts) !== null ? Math.ceil(p90(couts) * 1.2 * 10) / 10 : null,
      seuil_contexte_tokens: seuilContexteTokens,
      // Part du prompt fixe (contrat + fichiers d'instance) dans le fusible courant — médiane du
      // contexte de DÉPART (avant tout tour) rapportée à SEUIL_CONTEXTE_TOKENS_DEFAUT, jamais au
      // seuil proposé ci-dessus (qui varie avec les données, la part doit rester lisible face au
      // fusible réellement en vigueur tant que le mainteneur ne l'a pas changé).
      part_contexte_fixe: partContexteFixe,
      // Non calculable depuis SESSIONS.md : voir formatCalibrerReport / README (honnêteté, KERNEL §5.4).
      reserve_usd: null,
    },
  };
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function formatCalibrerReport(fichierPath, r) {
  const l = [];
  l.push(`Calibrage à partir de ${fichierPath}`);
  l.push(`  ${r.fichier.nSessions} session(s), ${r.fichier.nInstances} instance(s) distincte(s), colonne Réveil ${r.fichier.reveilPresent ? 'présente' : 'absente (format à dix colonnes)'}, colonne Contexte (départ/max) ${r.fichier.contexteInstantPresent ? 'présente' : 'absente'}.`);
  l.push('');
  l.push(`Coût USD/session    — médiane ${fmt(r.stats.coutUSD.mediane)}, p90 ${fmt(r.stats.coutUSD.p90)} (n=${r.stats.coutUSD.n})`);
  l.push(`Tours/session       — médiane ${fmt(r.stats.tours.mediane)}, p90 ${fmt(r.stats.tours.p90)} (n=${r.stats.tours.n})`);
  l.push(`Contexte (tokens)   — médiane ${fmt(r.stats.contexteTokens.mediane)}, p90 ${fmt(r.stats.contexteTokens.p90)} (n=${r.stats.contexteTokens.n}) — entrée+cache lu+cache écrit, même formule que le hook context-watch`);
  if (r.fichier.reveilPresent) l.push(`Réveil (caractères) — médiane ${fmt(r.stats.reveilCaracteres.mediane)}, p90 ${fmt(r.stats.reveilCaracteres.p90)} (n=${r.stats.reveilCaracteres.n}) — système+utilisateur au lancement, distinct du contexte en tokens ci-dessus`);
  if (r.stats.contexteInstantane) {
    l.push(`Contexte instantané — départ médiane ${fmt(r.stats.contexteInstantane.departMediane)}, max médiane ${fmt(r.stats.contexteInstantane.maxMediane)}, max p90 ${fmt(r.stats.contexteInstantane.maxP90)} (n=${r.stats.contexteInstantane.n}) — mesuré en cours de session (context-watch), pas seulement au réveil`);
  }
  l.push(`Hibernations/session — ${fmt(r.stats.hibernationsParSession)} (${r.stats.totalHibernations} sur ${r.fichier.nSessions} session(s) ; une hibernation = une session de plus qu'une pour une même Instance dans ce fichier)`);
  l.push('');
  l.push("Valeurs proposées (base de calcul explicite — une donnée, jamais un seuil tranché à la place du mainteneur) :");
  l.push(`  budget_usd_par_session ≈ ${fmt(r.propositions.budget_usd_par_session)}  (p90 du coût observé × 1,2 de marge, arrondi au dixième supérieur)`);
  l.push(`  seuil_contexte_tokens  ≈ ${fmt(r.propositions.seuil_contexte_tokens)}  (p90 du contexte max instantané${r.fichier.contexteInstantPresent ? '' : ' — repli sur le contexte tokens cumulé, colonne Contexte (départ/max) absente'}, arrondi au 5000 supérieur)`);
  if (r.propositions.part_contexte_fixe !== null) {
    l.push(`  part du contexte fixe  ≈ ${(r.propositions.part_contexte_fixe * 100).toFixed(0)} %  (médiane départ / seuil_contexte_tokens courant = ${SEUIL_CONTEXTE_TOKENS_DEFAUT})`);
  }
  l.push('  reserve_usd            — non calculable depuis ce fichier : SESSIONS.md ne consigne que le coût total, déjà terminé, de');
  l.push('                           chaque session, jamais le budget RESTANT au moment précis où elle a hiberné. Voir');
  l.push('                           framework/modules/recursion/reserve-hibernation.md, « Ce que ce module ne fait pas ».');
  return l.join('\n');
}

// ---------------------------------------------------------------------------
// --a-sec : rejoue les 7 scénarios (docs/IMPLEMENTATION.md §6.1) sur un scaffold jetable, à travers
// le VRAI holarch-spawn.js du dépôt (jamais une doublure) — même principe que B4-scenarios.test.js,
// dont cette section duplique le scaffold à l'identique (mêmes modules CONFIG.md, mêmes fichiers stub
// dont framework/KERNEL.md — son absence fait échouer findRoot silencieusement, piège de memoire/U6).
// ---------------------------------------------------------------------------
function trouverRacineDepot(depuis) {
  let dir = depuis;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'framework', 'bin', 'holarch-spawn.js')) && fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`trouverRacineDepot : dépôt réel introuvable depuis ${depuis}`);
}

// bench.js tourne soit depuis le staging du paquet (cible-tools/holarch-bench/, où base/framework
// n'existe pas) soit depuis tools/holarch-bench/ après promotion (où base/framework existe) — même
// bascule que appliquer.js.
function resoudreCible(nomReel) {
  const base = path.join(__dirname, '..', '..');
  const direct = path.join(base, nomReel);
  if (fs.existsSync(direct)) return direct;
  return path.join(base, `cible-${nomReel}`);
}

function gitHashFramework(racine) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD', '--', 'framework'], { cwd: racine, encoding: 'utf8' }).trim();
  } catch (e) {
    return '?';
  }
}

function jetableConfigMd(overrides = {}) {
  return `# Configuration — mission : banc-test
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | unites-indexees |
| 4 | recursion | max-depth |
| 5 | recursion | instance-budget |
| 6 | recursion | context-budget |
| 7 | conflits | typed-escalation |
| 8 | registre | sharded-files |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 8 |
| profondeur_max | 3 |
| commit_par_session | non |
| budget_usd_par_session | 5 |
| max_tours_par_session | 200 |
| seuil_contexte_tokens | 120000 |
| sessions_max_par_instance | ${overrides.sessions_max_par_instance || 24} |
| relances_max | ${overrides.relances_max === undefined ? 2 : overrides.relances_max} |
| mode_attente | ${overrides.mode_attente || 'synchrone'} |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| execution | sonnet | medium |
| exploration | fable | xhigh |
`;
}

function jetableStatus(etat, note, reveilTxt) {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note | ${note || ''} |\n| Réveil | ${reveilTxt || '—'} |\n`;
}

function jetableFiche(chemin, { alloue = 3, consomme = 0, profil = 'execution' } = {}) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | — |\n| Statut | READY |\n| Budget alloué / consommé | ${alloue} / ${consomme} |\n| Dépend de | — |\n| Profil | ${profil} |\n| Livrables | — |\n| Créée / Archivée | 2026-01-01T00:00:00Z / — |\n`;
}

function jetableSessionsHeader() {
  return '| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens (entrée/cache lu/cache créé/sortie) | Coût USD | Durée | Fin | STATUS | Réveil (car. système / utilisateur) |\n'
    + '|---|---|---|---|---|---|---|---|---|---|---|\n';
}

function makeJetableRoot(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-bench-a-sec-'));
  fs.mkdirSync(path.join(root, 'framework'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'KERNEL.md'), '# KERNEL\n(stub de banc — présence seule requise par findRoot)\n');
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), jetableConfigMd(overrides));
  fs.mkdirSync(path.join(root, 'mission', 'x'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mission', 'registry', 'instances'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission', 'x', 'ROLE.md'), '# ROLE\nTest.\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'MEMORY.md'), '# Mémoire\n(vide)\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'INBOX.md'), '# Inbox\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'OUTBOX.md'), '# Outbox\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'JOURNAL.md'), '# Journal\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), jetableStatus('READY'));
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'instances', 'x.md'), jetableFiche('x', { alloue: 3, consomme: 0 }));
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'ORG.md'), '# Organisation\n- x (READY)\n');
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), jetableSessionsHeader());
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

// Doit rester async/await (pas `return fn()`) : enfant-detache-reveil suspend réellement entre les
// deux wakeWaiters — un `return fn()` couperait l'env HOLARCH_FAKE_* avant la fin réelle du scénario
// (même piège documenté dans B4-scenarios.test.js::withFakeClaude).
async function withFakeEnv(seam, nomScenario, fn) {
  const scenarioPath = path.join(path.dirname(seam), 'scenarios', `${nomScenario}.json`);
  const before = { HOLARCH_FAKE_CLAUDE: process.env.HOLARCH_FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: process.env.HOLARCH_FAKE_SCENARIO };
  process.env.HOLARCH_FAKE_CLAUDE = seam;
  process.env.HOLARCH_FAKE_SCENARIO = scenarioPath;
  const attempt = `${scenarioPath}.attempt`;
  try { fs.unlinkSync(attempt); } catch (_) { /* pas encore de compteur */ }
  try {
    return await fn();
  } finally {
    if (before.HOLARCH_FAKE_CLAUDE === undefined) delete process.env.HOLARCH_FAKE_CLAUDE; else process.env.HOLARCH_FAKE_CLAUDE = before.HOLARCH_FAKE_CLAUDE;
    if (before.HOLARCH_FAKE_SCENARIO === undefined) delete process.env.HOLARCH_FAKE_SCENARIO; else process.env.HOLARCH_FAKE_SCENARIO = before.HOLARCH_FAKE_SCENARIO;
    try { fs.unlinkSync(attempt); } catch (_) { /* rien à nettoyer */ }
  }
}

function readStatusJetable(root) { return fs.readFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), 'utf8'); }
function readSessionsJetable(root) { return fs.readFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), 'utf8'); }

// Réutilise les parseurs génériques ci-dessus (aucune nouvelle logique d'agrégation) sur la
// SESSIONS.md du root JETABLE, pas sur un fichier archivé.
function calculerMetriques(root) {
  let text = '';
  try { text = readSessionsJetable(root); } catch (_) { /* pas de session écrite */ }
  const { headers, rows } = parseSessionsMd(text);
  const colCout = findCol(headers, ['coût', 'cout']);
  const colTours = findCol(headers, ['tours']);
  const colContexteInstant = findCol(headers, ['contexte (départ', 'contexte (depart']);
  const couts = colCout ? rows.map((r) => parseNumberCell(r[colCout])).filter((n) => n !== null) : [];
  const tours = colTours ? rows.map((r) => parseNumberCell(r[colTours])).filter((n) => n !== null) : [];
  const maxs = colContexteInstant
    ? rows.map((r) => parseContexteInstantCell(r[colContexteInstant])).filter((c) => c !== null).map((c) => c.max)
    : [];
  const nSessions = rows.length;
  return {
    usd: couts.reduce((a, n) => a + n, 0),
    tours: tours.reduce((a, n) => a + n, 0),
    reveils: Math.max(0, nSessions - 1),
    contexteMaxMoyen: maxs.length ? maxs.reduce((a, n) => a + n, 0) / maxs.length : null,
    hibernationsParSession: nSessions ? Math.max(0, nSessions - 1) / nSessions : null,
  };
}

function registreHeader() {
  return '| date | hash framework | étage | scénario ou mission | USD | tours | réveils | contexte max moyen (instantané) | hibernations/session | verdict |\n'
    + '|---|---|---|---|---|---|---|---|---|---|\n';
}

function ensureRegistre(chemin) {
  if (fs.existsSync(chemin)) return;
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, `# Registre du banc de mesure (chantier 5)\n\n${registreHeader()}`);
}

function appendRegistreLigne(chemin, l) {
  const m = l.metriques;
  const cells = [
    l.date, l.hashFramework, l.etage, l.scenarioOuMission,
    fmt(m.usd), fmt(m.tours), fmt(m.reveils),
    m.contexteMaxMoyen === null ? '—' : fmt(m.contexteMaxMoyen),
    m.hibernationsParSession === null ? '—' : m.hibernationsParSession.toFixed(2),
    l.verdict,
  ];
  fs.appendFileSync(chemin, `| ${cells.join(' | ')} |\n`);
}

// Les 6 scénarios « simples » partagent le même flux : launchWithRelaunches(root,'x',{}) (le 3e
// argument est TOUJOURS {} — c'est le CONFIG.md du root jetable, posé à makeJetableRoot, qui porte
// les overrides, jamais cet appel, exactement comme B4-scenarios.test.js) puis summarize.
function scenarioSimple(spawnMod, root) {
  const sessions = spawnMod.launchWithRelaunches(root, 'x', {});
  const { code, text } = spawnMod.summarize(sessions[sessions.length - 1].launch, sessions);
  return { sessions, code, text };
}

function verifierLivraisonSimple({ sessions, code }, root) {
  if (code !== 0) return `code ${code} attendu 0`;
  if (sessions.length !== 1) return `sessions.length ${sessions.length} attendu 1`;
  if (!/\| État \| DELIVERED \|/.test(readStatusJetable(root))) return 'STATUS.md pas DELIVERED';
  const lignes = readSessionsJetable(root).trim().split('\n');
  if (lignes.length !== 3) return `SESSIONS.md ${lignes.length} lignes attendu 3`;
  return null;
}

function verifierHibernationPuisLivraison({ sessions, code }, root) {
  if (code !== 0) return `code ${code} attendu 0`;
  if (sessions.length !== 2) return `sessions.length ${sessions.length} attendu 2`;
  const memory = fs.readFileSync(path.join(root, 'mission', 'x', 'MEMORY.md'), 'utf8');
  if (!memory.includes('MARQUEUR-U-HIBERNATION-42')) return 'MEMORY.md sans marqueur de hibernation';
  if (!/\| État \| DELIVERED \|/.test(readStatusJetable(root))) return 'STATUS.md pas DELIVERED';
  return null;
}

function verifierChangementDeRegime(spawnMod, { sessions, code }, root) {
  if (code !== 0) return `code ${code} attendu 0`;
  if (sessions.length !== 2) return `sessions.length ${sessions.length} attendu 2`;
  const fiche1 = spawnMod.parseFiche(fs.readFileSync(path.join(root, 'mission', 'registry', 'instances', 'x.md'), 'utf8'));
  const profil = fiche1.profil || fiche1.Profil;
  if (profil !== 'exploration') return `profil ${profil} attendu exploration`;
  if (!/\| État \| DELIVERED \|/.test(readStatusJetable(root))) return 'STATUS.md pas DELIVERED';
  return null;
}

function verifierCrashSansJson({ sessions, code }, root) {
  if (code !== 2) return `code ${code} attendu 2`;
  if (!(sessions.length >= 1)) return `sessions.length ${sessions.length} attendu >= 1`;
  const lignes = readSessionsJetable(root).trim().split('\n');
  if (!(lignes.length >= 3)) return `SESSIONS.md ${lignes.length} lignes attendu >= 3`;
  return null;
}

function verifierBudgetEpuise({ code, text }) {
  if (code !== 2) return `code ${code} attendu 2`;
  if (!(typeof text === 'string' && text.length > 0)) return 'text vide ou absent';
  return null;
}

function verifierArretDemande({ sessions, code }, root) {
  if (code !== 0) return `code ${code} attendu 0`;
  if (sessions.length !== 1) return `sessions.length ${sessions.length} attendu 1`;
  if (!/hibernation volontaire \(arrêt demandé\)/.test(readStatusJetable(root))) return 'note "hibernation volontaire (arrêt demandé)" absente';
  return null;
}

async function waitForBench(pred, { timeoutMs = 8000, stepMs = 25 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

// Flux spécial (pas via scenarioSimple/verifierXxx) : reproduit exactement
// B4-scenarios.test.js (test enfant-detache-reveil) — wakeWaiters avant/après écriture de .pret,
// puis attente de DELIVERED.
async function scenarioEnfantDetacheReveil(spawnMod, root) {
  fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), jetableStatus('WAITING_CHILDREN', '', 'fichier:mission/x/.pret'));
  const avant = spawnMod.wakeWaiters(root, '--reveil');
  if (avant.length !== 0) return `wakeWaiters avant : ${avant.length} attendu 0`;
  if (spawnMod.isLive(root, 'x')) return 'isLive avant : true attendu false';
  if (!/\| État \| WAITING_CHILDREN \|/.test(readStatusJetable(root))) return 'STATUS.md pas WAITING_CHILDREN avant réveil';
  fs.writeFileSync(path.join(root, 'mission', 'x', '.pret'), 'ok');
  const reveilles = spawnMod.wakeWaiters(root, '--reveil');
  if (reveilles.length !== 1) return `wakeWaiters après : ${reveilles.length} attendu 1`;
  if (reveilles[0].chemin !== 'x') return `wakeWaiters après : chemin ${reveilles[0].chemin} attendu x`;
  const devenuDelivered = await waitForBench(() => readStatusJetable(root).includes('| État | DELIVERED |'), { timeoutMs: 8000 });
  if (!devenuDelivered) return 'DELIVERED non atteint sous 8000ms';
  return null;
}

async function runASec() {
  const racine = trouverRacineDepot(__dirname);
  const hashFramework = gitHashFramework(racine);
  const date = new Date().toISOString();
  const spawnMod = require(path.join(racine, 'framework', 'bin', 'holarch-spawn.js'));
  const seam = path.join(resoudreCible('framework'), 'tests', 'fake-claude.js');
  const registrePath = path.join(resoudreCible('docs'), 'bench', 'REGISTRE.md');
  ensureRegistre(registrePath);

  const scenarios = [
    { nom: 'livraison-simple', overrides: {}, verifier: verifierLivraisonSimple },
    { nom: 'hibernation-puis-livraison', overrides: {}, verifier: verifierHibernationPuisLivraison },
    { nom: 'changement-de-regime', overrides: { relances_max: 0 }, verifier: (r, root) => verifierChangementDeRegime(spawnMod, r, root) },
    { nom: 'crash-sans-json', overrides: { relances_max: 0 }, verifier: verifierCrashSansJson },
    { nom: 'budget-epuise', overrides: { relances_max: 0 }, verifier: verifierBudgetEpuise },
    { nom: 'enfant-detache-reveil', overrides: { mode_attente: 'detache' }, special: true },
    { nom: 'arret-demande', overrides: {}, verifier: verifierArretDemande },
  ];

  let echecs = 0;
  for (const sc of scenarios) {
    const root = makeJetableRoot(sc.overrides);
    let verdict = null;
    try {
      if (sc.special) {
        verdict = await withFakeEnv(seam, sc.nom, () => scenarioEnfantDetacheReveil(spawnMod, root));
      } else {
        const resultat = await withFakeEnv(seam, sc.nom, () => scenarioSimple(spawnMod, root));
        verdict = sc.verifier(resultat, root);
      }
    } catch (e) {
      verdict = `ERREUR : ${e.message}`;
    }
    appendRegistreLigne(registrePath, {
      date, hashFramework, etage: 'à sec', scenarioOuMission: sc.nom, metriques: calculerMetriques(root),
      verdict: verdict ? `FAIL — ${verdict}` : 'PASS',
    });
    process.stdout.write(`${verdict ? 'FAIL' : 'PASS'} ${sc.nom}${verdict ? ` — ${verdict}` : ''}\n`);
    if (verdict) echecs++;
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write(`\n${scenarios.length - echecs}/${scenarios.length} scénarios PASS.\n`);
  return echecs ? 1 : 0;
}

// ---------------------------------------------------------------------------
// --reel : lance le VRAI holarch-spawn.js du dépôt (--bootstrap) sur une mission d'exemple, dans une
// racine jetable qui contient une copie complète et réelle de framework/ (jamais un stub, contrairement
// à --a-sec) — voir memoire/U11-conception-reel-non-codee.md et U12-affinement-plan-reel-non-code.md.
// ---------------------------------------------------------------------------
const MISSIONS_EXEMPLE = { t3: 'docs/examples/t3-csvjson-mission' };

// Remplace la ligne `| key | ... |` de la table sous `## Paramètres` si elle existe, sinon l'insère
// juste après l'en-tête + séparateur de cette table (mêmes regex d'en-tête/séparateur que
// parseSessionsMd, appliquées ici à une table de paramètres plutôt qu'à SESSIONS.md).
function overrideParamRow(md, key, value) {
  const lignes = md.split('\n');
  const ligneRegex = new RegExp(`^\\|\\s*${key}\\s*\\|`);
  for (let i = 0; i < lignes.length; i++) {
    if (ligneRegex.test(lignes[i])) {
      lignes[i] = `| ${key} | ${value} |`;
      return lignes.join('\n');
    }
  }
  const secIdx = lignes.findIndex((l) => l.trim() === '## Paramètres');
  if (secIdx === -1) throw new Error('overrideParamRow : section "## Paramètres" introuvable');
  let headerIdx = -1;
  for (let i = secIdx + 1; i < lignes.length; i++) {
    if (/^\|.*\|\s*$/.test(lignes[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1 || !/^\|[\s:|-]*-{3,}[\s:|-]*\|\s*$/.test(lignes[headerIdx + 1] || '')) {
    throw new Error('overrideParamRow : table "## Paramètres" introuvable ou malformée');
  }
  lignes.splice(headerIdx + 2, 0, `| ${key} | ${value} |`);
  return lignes.join('\n');
}

// Extrait le bloc ```markdown ...``` du preset réel (framework/presets/solo-light.md — même preset
// que celui déjà actif pour cette mission, ROLE.md « Contexte hérité »), renomme la mission, applique
// les overrides de sûreté décidés en U12 : sessions_max_par_instance:1 (borne dure, indépendante du
// progrès — relances_max:0 seul ne suffit pas, memoire/U12 §« Défaut trouvé ») et
// budget_usd_par_session égal au budget CLI (plafonne aussi un enfant éventuel).
function jetableConfigMdReel(depotReel, nomMission, overrides = {}) {
  const presetPath = path.join(depotReel, 'framework', 'presets', 'solo-light.md');
  const texte = fs.readFileSync(presetPath, 'utf8');
  const m = texte.match(/```markdown\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`jetableConfigMdReel : bloc markdown introuvable dans ${presetPath}`);
  let md = m[1].replace('<nom de la mission>', nomMission);
  for (const [key, value] of Object.entries(overrides)) md = overrideParamRow(md, key, value);
  return md;
}

// Même recette que makeJetableRoot (ci-dessus) mais avec le VRAI framework/ du dépôt (fs.cpSync
// récursif, jamais un stub) et le VRAI OBJECTIVE.md de la mission d'exemple — --bootstrap crée
// lui-même mission/concepteur/... au fil de la session, il n'y a rien d'autre à poser d'avance.
function makeJetableRootReel(depotReel, nomMission, objectifPath, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-bench-reel-'));
  fs.cpSync(path.join(depotReel, 'framework'), path.join(root, 'framework'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), jetableConfigMdReel(depotReel, nomMission, overrides));
  fs.mkdirSync(path.join(root, 'mission'), { recursive: true });
  fs.copyFileSync(objectifPath, path.join(root, 'mission', 'OBJECTIVE.md'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

// execFileSync lève sur code de sortie non nul : ici on veut TOUJOURS le code, jamais une exception —
// --bootstrap peut légitimement sortir en 2 (crash/hibernation ratée) sans que ce soit un bug de bench.js.
function spawnCapture(cmd, args, opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, Object.assign({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts));
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, stdout: e.stdout ? String(e.stdout) : '', stderr: e.stderr ? String(e.stderr) : (e.message || '') };
  }
}

function lireEtatInstance(root, chemin) {
  try { return fs.readFileSync(path.join(root, 'mission', chemin, 'STATUS.md'), 'utf8'); } catch (e) { return ''; }
}

// Contrairement aux verifierXxx de --a-sec (qui comparent à un comportement attendu et précis, ROLE.md),
// --reel n'a pas de résultat attendu à trancher (ROLE.md : « fournir l'instrument, pas trancher les
// seuils ») : le verdict est un CONSTAT factuel (état + note), jamais un PASS/FAIL.
function verdictReel(txt) {
  const mEtat = /\| État \| (\w+) \|/.exec(txt);
  const mNote = /\| Note \| (.*) \|/.exec(txt);
  const etat = mEtat ? mEtat[1] : '?';
  const note = mNote ? mNote[1].trim() : '';
  return note ? `${etat} — ${note}` : etat;
}

async function runReel(mission, budgetUsd) {
  const chemin = MISSIONS_EXEMPLE[mission];
  if (!chemin) {
    const texte = `bench.js --reel : mission inconnue "${mission}" (connues : ${Object.keys(MISSIONS_EXEMPLE).join(', ')})`;
    process.stderr.write(`${texte}\n`);
    return { code: 1, texte };
  }
  const depotReel = trouverRacineDepot(__dirname);
  const objectifPath = path.join(depotReel, chemin, 'OBJECTIVE.md');
  const hashFramework = gitHashFramework(depotReel);
  const date = new Date().toISOString();
  const registrePath = path.join(resoudreCible('docs'), 'bench', 'REGISTRE.md');
  ensureRegistre(registrePath);

  // Overrides de sûreté (memoire/U12) : relances_max:0 ne bloque QUE les ré-incarnations sans progrès
  // (L1148/1153 holarch-spawn.js) — sessions_max_par_instance:1 borne la racine à une session quoi
  // qu'il arrive, budget_usd_par_session=budgetUsd plafonne aussi un enfant éventuel au même montant.
  const overrides = { relances_max: 0, sessions_max_par_instance: 1, budget_usd_par_session: budgetUsd };
  const root = makeJetableRootReel(depotReel, `banc-reel-${mission}`, objectifPath, overrides);
  const spawnPath = path.join(root, 'framework', 'bin', 'holarch-spawn.js');
  const argsCommuns = [spawnPath, '--bootstrap', '--root', root, '--budget-usd', String(budgetUsd)];

  try {
    process.stdout.write(`--- dry-run (${mission}, ${budgetUsd} USD) ---\n`);
    const dry = spawnCapture('node', [...argsCommuns, '--dry-run'], { cwd: root });
    process.stdout.write(`${dry.stdout}${dry.stderr}`);
    if (dry.code !== 0) {
      const texte = `bench.js --reel : dry-run en échec (code ${dry.code}) — run réel NON lancé, 0 USD dépensé`;
      process.stdout.write(`${texte}\n`);
      return { code: dry.code, texte };
    }

    process.stdout.write(`\n--- run réel (jusqu'à ${budgetUsd} USD) ---\n`);
    const reel = spawnCapture('node', argsCommuns, { cwd: root });
    process.stdout.write(`${reel.stdout}${reel.stderr}\n`);

    const etatTxt = lireEtatInstance(root, 'concepteur');
    const verdict = verdictReel(etatTxt);
    const metriques = calculerMetriques(root);
    appendRegistreLigne(registrePath, { date, hashFramework, etage: 'réel', scenarioOuMission: mission, metriques, verdict });

    process.stdout.write(`--- mission/registry/SESSIONS.md (root jetable, avant nettoyage) ---\n${readSessionsJetable(root)}\n`);
    process.stdout.write(`--- mission/concepteur/STATUS.md (root jetable, avant nettoyage) ---\n${etatTxt}\n`);

    return { code: reel.code, texte: verdict };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// --calibrer --transcriptions : reconstitue depart/max/tours d'une session depuis sa transcription
// Claude Code (~/.claude/projects/…/*.jsonl), pour calibrer sans dépendre d'un fichier live déjà écrit
// par context-watch — utile sur des sessions passées (missions archivées, ex. holarch-banc).
// ---------------------------------------------------------------------------

// Même formule que context-watch (framework/hooks/holarch-hooks.js, lastAssistantUsage/contextWatch,
// l.341-381 cible) : tokens = input + cache lu + cache créé, sortie explicitement exclue — identique
// à parseTokensCell/parseContexteInstantCell ci-dessus, pour que les deux voies de calibrage
// (SESSIONS.md ou transcriptions) mesurent la même grandeur.
function reconstituerSessionTranscription(transcriptPath) {
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch (e) { return null; }
  let depart = null;
  let max = null;
  let tours = 0;
  for (const ligne of text.split('\n')) {
    if (!ligne.includes('"assistant"') || !ligne.includes('"usage"')) continue;
    let obj;
    try { obj = JSON.parse(ligne); } catch (e) { continue; }
    if (!obj || obj.type !== 'assistant' || !obj.message || !obj.message.usage) continue;
    const u = obj.message.usage;
    const input = Number(u.input_tokens) || 0;
    const cacheLu = Number(u.cache_read_input_tokens) || 0;
    const cacheCree = Number(u.cache_creation_input_tokens) || 0;
    const tokens = input + cacheLu + cacheCree;
    if (depart === null) depart = tokens;
    if (max === null || tokens > max) max = tokens;
    tours++;
  }
  if (tours === 0) return null;
  return { depart, max, tours };
}

// Construit un texte façon SESSIONS.md (colonnes Instance / Tours / Contexte (départ / max)) à partir
// d'un dossier de transcriptions *.jsonl, réinjectable tel quel dans calibrer() — même pipeline par
// nom de colonne que --calibrer <fichier>, aucune nouvelle logique d'agrégation.
function sessionsMdDepuisTranscriptions(dossier) {
  const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith('.jsonl')).sort();
  const lignes = ['| Instance | Tours | Contexte (départ / max) |', '|---|---|---|'];
  for (const f of fichiers) {
    const r = reconstituerSessionTranscription(path.join(dossier, f));
    if (!r) continue;
    const nom = f.replace(/\.jsonl$/, '');
    lignes.push(`| ${nom} | ${r.tours} | ${r.depart} / ${r.max} |`);
  }
  return lignes.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage() {
  return [
    'Usage :',
    '  node bench.js --a-sec',
    '  node bench.js --reel <mission> --budget-usd <n>',
    '  node bench.js --calibrer <fichier-SESSIONS.md>',
    '  node bench.js --calibrer --transcriptions <dossier-de-*.jsonl>',
  ].join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  if (args[0] === '--calibrer') {
    const transIdx = args.indexOf('--transcriptions');
    let fichierPath;
    let text;
    if (transIdx !== -1) {
      const dossier = args[transIdx + 1];
      if (!dossier) {
        process.stderr.write(`bench.js --calibrer --transcriptions requiert un chemin de dossier\n${usage()}\n`);
        process.exitCode = 1;
        return;
      }
      fichierPath = `${dossier} (transcriptions *.jsonl)`;
      try { text = sessionsMdDepuisTranscriptions(dossier); } catch (e) {
        process.stderr.write(`bench.js --calibrer --transcriptions : impossible de lire ${dossier} (${e.message})\n`);
        process.exitCode = 1;
        return;
      }
    } else {
      fichierPath = args[1];
      if (!fichierPath) {
        process.stderr.write(`bench.js --calibrer requiert un chemin de fichier SESSIONS.md\n${usage()}\n`);
        process.exitCode = 1;
        return;
      }
      try { text = fs.readFileSync(fichierPath, 'utf8'); } catch (e) {
        process.stderr.write(`bench.js --calibrer : impossible de lire ${fichierPath} (${e.message})\n`);
        process.exitCode = 1;
        return;
      }
    }
    const r = calibrer(text);
    process.stdout.write(`${formatCalibrerReport(fichierPath, r)}\n`);
    return;
  }
  if (args[0] === '--a-sec') {
    return runASec().then((code) => { process.exitCode = code; });
  }
  if (args[0] === '--reel') {
    const mission = args[1];
    const budgetIdx = args.indexOf('--budget-usd');
    const budgetUsd = budgetIdx !== -1 ? Number(args[budgetIdx + 1]) : NaN;
    if (!mission || mission.startsWith('--') || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      process.stderr.write(`bench.js --reel requiert <mission> --budget-usd <n>\n${usage()}\n`);
      process.exitCode = 1;
      return;
    }
    return runReel(mission, budgetUsd).then((r) => {
      process.exitCode = r.code;
    });
  }
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
}

module.exports = {
  parseSessionsMd,
  findCol,
  parseNumberCell,
  parseTokensCell,
  parseReveilCell,
  parseContexteInstantCell,
  median,
  p90,
  calibrer,
  formatCalibrerReport,
  trouverRacineDepot,
  resoudreCible,
  gitHashFramework,
  makeJetableRoot,
  calculerMetriques,
  runASec,
  makeJetableRootReel,
  runReel,
  reconstituerSessionTranscription,
  sessionsMdDepuisTranscriptions,
};

if (require.main === module) {
  const p = main(process.argv);
  if (p && typeof p.catch === 'function') {
    p.catch((e) => {
      process.stderr.write(`bench.js : erreur inattendue (${e.stack || e.message})\n`);
      process.exitCode = 1;
    });
  }
}
