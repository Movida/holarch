#!/usr/bin/env node
'use strict';
/**
 * message-lint — contrôle de format et de provenance des messages INBOX/OUTBOX (KERNEL §7,
 * `docs/IMPLEMENTATION.md` §5.2).
 *
 * Usage :
 *   node message-lint.js <INBOX.md|OUTBOX.md> [--blame] [--json]
 *
 * Contrôles de format (toujours) : chaque bloc commence par `id:`, les six champs
 * `id, from, to, type, ref, date` sont présents, `type` est l'un des sept types du KERNEL §7,
 * `date` est une date ISO 8601 valide, `origine` (si présent) est l'une des cinq valeurs du
 * gabarit (`framework/templates/MESSAGE.template.md`), et le numéro séquentiel d'un `id` est
 * strictement croissant **au sein de son propre préfixe** (`id` = `<préfixe>-<numéro>`, préfixe =
 * tout ce qui précède le dernier `-` — un id sans suffixe numérique n'est simplement pas soumis au
 * contrôle). Portée volontairement locale au préfixe, pas globale au fichier : une même `INBOX.md`
 * reçoit des messages de plusieurs émetteurs, chacun avec son propre compteur (`MSG-<chemin-abrégé>-
 * <numéro-séquentiel>`, gabarit) — un ordre global par comparaison de chaîne produisait de fausses
 * anomalies dès que deux préfixes s'entrelacent chronologiquement (constaté sur le corpus archivé
 * `docs/archive/mission-holon-v2/concepteur/INBOX.md`, diagnostic U4). Indépendamment de ce contrôle
 * de croissance, l'`id` complet (chaîne entière, suffixe numérique ou non) doit être unique dans tout
 * le fichier : un doublon est une anomalie de format, même si aucun des deux contrôles précédents ne
 * la détecterait seule (deux préfixes différents, ou deux ids identiques sans suffixe numérique).
 *
 * Le découpage en blocs (`decouperBlocs`) n'ouvre une enveloppe que sur un `---` immédiatement suivi
 * d'une ligne `id:` — un `---` isolé dans le corps d'un message (filet de séparation en prose,
 * markdown libre autorisé par KERNEL §7) ne referme donc jamais un message par erreur (même corpus,
 * même diagnostic : un seul filet en prose desynchronisait 26 blocs jusqu'à la fin du fichier).
 *
 * Avec --blame (dépôt Git requis) : pour chaque message, déduit l'auteur réel de sa ligne `id:`
 * (`git blame` puis `git log -1 --format=%s` sur le commit trouvé). Si le sujet du commit
 * commence par `[<from>]` (ou `[bootstrap]` quand `from` est une instance racine, sans `/`),
 * l'origine est vérifiée. Si le sujet commence par `[<autre>]`, l'origine est déduite comme
 * `<autre>` et déclarée NON vérifiée. Si le sujet ne commence pas par `[`, c'est un commit humain :
 * origine déduite `utilisateur`, vérifiée (un humain n'usurpe pas une instance). Si `git blame`
 * rapporte un sha nul (ligne présente dans le fichier de travail mais jamais committée), l'origine
 * est déclarée NON vérifiée avec un motif explicite, sans même tenter `git log` sur ce sha : un
 * parent doit committer son message avant de réveiller son enfant, sinon son ordre sera filtré
 * (conséquence de protocole, voir README et `typed-escalation` 1.1.0).
 *
 * Codes de sortie : 0 tout vérifié, 1 au moins une anomalie de format, 2 au moins une origine non
 * vérifiée (nécessite --blame), 3 les deux cumulées.
 *
 * Sans dépendance (Node ≥ 18). --blame invoque `git` via execFileSync (jamais de shell).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TYPES_VALIDES = ['TASK', 'DELIVERABLE', 'BLOCKER', 'CLARIFICATION', 'PROPOSAL', 'ALERT', 'RESPONSE'];
const ORIGINES_VALIDES = ['parent', 'enfant', 'utilisateur', 'harnais', 'externe'];
const CHAMPS_REQUIS = ['id', 'from', 'to', 'type', 'ref', 'date'];
const DATE_ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

const CHAMPS_ENVELOPPE = ['id', 'from', 'to', 'type', 'ref', 'date', 'origine'];

/**
 * Ouvertures d'enveloppe d'un fichier INBOX/OUTBOX (gabarit MESSAGE.template.md) : un "---"
 * **immédiatement suivi** d'une ligne commençant par l'un des sept champs du gabarit (KERNEL §7) —
 * jamais un "---" isolé : le corps d'un message (markdown libre) peut lui-même contenir une ligne
 * "---" (filet de séparation en prose), qui n'entre donc dans aucune de ces sept familles.
 * `valide` n'est vrai que si le premier champ est "id" (ordre imposé par le gabarit) : une
 * ouverture sur un autre champ (`from:`, …) est une enveloppe malformée (§5.1 B2), ni ignorée comme
 * un "---" de prose, ni absorbée en silence dans le corps du message précédent — `decouperBlocs`
 * en fait tout de même une borne de bloc (elle démarre son propre bloc), et `analyserMessages` fait
 * remonter ce bloc comme anomalie de format puisque son premier champ n'est pas "id".
 * Constat corpus (diagnostic U4/U9, `docs/archive/mission-holon-v2/concepteur/INBOX.md`) : élargir
 * ainsi la détection aux sept champs, contre "id:" seul avant ce correctif, ne crée aucun faux
 * positif — aucune des 97 lignes "---" du corpus n'y est suivie d'un de ces sept champs.
 */
function trouverOuvertures(texte) {
  const lignes = String(texte || '').split('\n');
  const offsets = [];
  let acc = 0;
  for (const l of lignes) { offsets.push(acc); acc += l.length + 1; }
  const re = new RegExp(`^(${CHAMPS_ENVELOPPE.join('|')}):`);
  const out = [];
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i].trim() !== '---' || i + 1 >= lignes.length) continue;
    const m = re.exec(lignes[i + 1].trim());
    if (m) out.push({ offset: offsets[i], ligneIndex: i, champ: m[1], valide: m[1] === 'id' });
  }
  return out;
}

/**
 * Découpe le texte en blocs de message : **toutes** les ouvertures de `trouverOuvertures` bornent
 * un bloc, valides ("id:" en tête) ou non ("from:", etc.) — un "---" isolé en prose n'en est
 * toujours pas une (diagnostic U4, découpage non désynchronisé), mais une ouverture non valide
 * n'est plus absorbée en silence dans le message précédent : elle démarre son propre bloc, dont le
 * premier champ n'est pas "id" — `analyserMessages` le détecte et le fait remonter en anomalie
 * (§5.1 B2 point 2), au lieu de disparaître sans trace dans le corps d'un autre message.
 */
function decouperBlocs(texte) {
  const lignes = String(texte).split('\n');
  const ouvertures = trouverOuvertures(texte).map((o) => o.ligneIndex);
  const blocs = [];
  for (let idx = 0; idx < ouvertures.length; idx++) {
    const i = ouvertures[idx];
    let j = i + 1;
    const champsBruts = [];
    while (j < lignes.length && lignes[j].trim() !== '---') {
      champsBruts.push({ ligne: j, texte: lignes[j] });
      j++;
    }
    if (j >= lignes.length) break; // pas de '---' fermant : bloc incomplet, ignoré
    const finFrontmatter = j;
    const finCorps = idx + 1 < ouvertures.length ? ouvertures[idx + 1] : lignes.length;
    const corps = lignes.slice(finFrontmatter + 1, finCorps).join('\n').trim();
    blocs.push({ debut: i, champsBruts, corps });
  }
  return blocs;
}

/** Bloc de lignes de frontmatter → { champs: {nom: valeur}, lignesChamps: {nom: index 0-based} }. */
function parseChamps(champsBruts) {
  const champs = {};
  const lignesChamps = {};
  for (const { ligne, texte } of champsBruts) {
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(texte);
    if (!m) continue;
    const nom = m[1].trim().toLowerCase();
    champs[nom] = m[2].trim();
    lignesChamps[nom] = ligne;
  }
  return { champs, lignesChamps };
}

function dateValide(v) {
  return DATE_ISO.test(String(v || '')) && !Number.isNaN(Date.parse(v));
}

/** Déduit l'origine d'un message à partir du sujet du commit qui a écrit sa ligne `id:` (§5.2). */
function deduireOrigine(sujet, from) {
  const m = /^\[([^\]]+)\]/.exec(String(sujet || '').trim());
  if (!m) return { origine: 'utilisateur', verifiee: true, motif: 'commit humain (sujet sans préfixe [instance])' };
  const auteur = m[1];
  const racine = !String(from || '').includes('/');
  if (auteur === from || (auteur === 'bootstrap' && racine)) {
    return { origine: auteur, verifiee: true, motif: `auteur du commit = ${auteur}` };
  }
  return { origine: auteur, verifiee: false, motif: `auteur du commit = ${auteur} (attendu from=${from})` };
}

/**
 * Analyse un texte INBOX/OUTBOX : contrôles de format (§5.2) + déduction de provenance par
 * `git blame` si `blame` est demandé (nécessite `root` et `fichier`, chemin relatif à `root`,
 * dans un dépôt Git réel).
 * @param {string} texte
 * @param {{root?:string, fichier?:string, blame?:boolean}} options
 * @returns {Array<{id,from,to,type,ref,date,origine,verifiee,motif,sha,anomalies:string[]}>}
 */
function analyserMessages(texte, options) {
  const opts = options || {};
  const blocs = decouperBlocs(texte);
  const messages = [];
  const dernierNumeroParPrefixe = new Map();
  const idsVus = new Set();
  for (const bloc of blocs) {
    const { champs, lignesChamps } = parseChamps(bloc.champsBruts);
    const anomalies = [];

    if (!bloc.champsBruts.length || !/^id:/.test(bloc.champsBruts[0].texte.trim())) {
      anomalies.push('le bloc ne commence pas par "id:"');
    }
    for (const c of CHAMPS_REQUIS) {
      if (!(c in champs) || champs[c] === '') anomalies.push(`champ "${c}" absent ou vide`);
    }
    if (champs.type && !TYPES_VALIDES.includes(champs.type)) {
      anomalies.push(`type "${champs.type}" inconnu (attendu : ${TYPES_VALIDES.join(', ')})`);
    }
    if (champs.date && !dateValide(champs.date)) {
      anomalies.push(`date "${champs.date}" n'est pas une date ISO 8601 valide`);
    }
    if (champs.origine && !ORIGINES_VALIDES.includes(champs.origine)) {
      anomalies.push(`origine "${champs.origine}" inconnue (attendu : ${ORIGINES_VALIDES.join(', ')})`);
    }
    if (champs.id) {
      if (idsVus.has(champs.id)) {
        anomalies.push(`id "${champs.id}" déjà utilisé par un message précédent (unicité)`);
      }
      idsVus.add(champs.id);
      const suffixe = /^(.*)-(\d+)$/.exec(champs.id);
      if (suffixe) {
        const prefixe = suffixe[1];
        const numero = parseInt(suffixe[2], 10);
        const precedent = dernierNumeroParPrefixe.get(prefixe);
        if (precedent !== undefined && numero <= precedent) {
          anomalies.push(`id "${champs.id}" n'est pas strictement croissant après le numéro ${precedent} pour le préfixe "${prefixe}"`);
        }
        dernierNumeroParPrefixe.set(prefixe, numero);
      }
    }

    let origine = champs.origine;
    let verifiee;
    let motif;
    let sha;
    if (opts.blame && champs.id && lignesChamps.id !== undefined) {
      const GIT_SILENCIEUX = { cwd: opts.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
      try {
        const numLigne = lignesChamps.id + 1;
        const blame = execFileSync('git', ['blame', '-L', `${numLigne},${numLigne}`, '--porcelain', '--', opts.fichier], GIT_SILENCIEUX);
        sha = blame.split('\n', 1)[0].split(' ')[0];
        if (/^0+$/.test(sha)) {
          verifiee = false;
          motif = 'message non encore committé : la ligne "id:" existe dans le fichier de travail mais pas dans l\'historique Git (git blame la rapporte sous un sha nul)';
        } else {
          const sujet = execFileSync('git', ['log', '-1', '--format=%s', sha], GIT_SILENCIEUX).trim();
          const deduit = deduireOrigine(sujet, champs.from);
          origine = deduit.origine;
          verifiee = deduit.verifiee;
          motif = deduit.motif;
        }
      } catch (e) {
        verifiee = false;
        motif = `git blame indisponible : ${e.message}`;
      }
    }

    messages.push({
      id: champs.id, from: champs.from, to: champs.to, type: champs.type, ref: champs.ref,
      date: champs.date, origine, verifiee, motif, sha, anomalies,
    });
  }
  return messages;
}

function parseArgs(argv) {
  const o = { fichier: null, blame: false, json: false };
  const positionnels = [];
  for (const a of argv) {
    if (a === '--blame') o.blame = true;
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) throw new Error(`option inconnue : ${a}`);
    else positionnels.push(a);
  }
  if (positionnels.length !== 1) throw new Error('usage : message-lint.js <INBOX.md|OUTBOX.md> [--blame] [--json]');
  o.fichier = positionnels[0];
  return o;
}

function racineGit(fichierAbsolu) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: path.dirname(fichierAbsolu), encoding: 'utf8' }).trim();
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`message-lint : ${e.message}\n`);
    return 1;
  }
  const chemin = path.resolve(options.fichier);
  let texte;
  try {
    texte = fs.readFileSync(chemin, 'utf8');
  } catch (e) {
    process.stderr.write(`message-lint : ${e.message}\n`);
    return 1;
  }
  let root;
  let fichierRelatif;
  if (options.blame) {
    try {
      root = racineGit(chemin);
      fichierRelatif = path.relative(root, chemin).split(path.sep).join('/');
    } catch (e) {
      process.stderr.write(`message-lint : --blame demande un dépôt Git (${e.message})\n`);
      return 1;
    }
  }
  const messages = analyserMessages(texte, { root, fichier: fichierRelatif, blame: options.blame });

  const anomalieFormat = messages.some((m) => m.anomalies.length > 0);
  const origineNonVerifiee = options.blame && messages.some((m) => m.verifiee === false);
  const code = (anomalieFormat ? 1 : 0) | (origineNonVerifiee ? 2 : 0);

  if (options.json) {
    process.stdout.write(JSON.stringify(messages, null, 2) + '\n');
  } else {
    process.stdout.write(`message-lint · ${options.fichier}${options.blame ? ' (--blame)' : ''}\n`);
    for (const m of messages) {
      const statut = options.blame
        ? (m.verifiee ? `VERIFIEE : ${m.motif}` : `NON VERIFIEE : ${m.motif}`)
        : '(blame non demandé)';
      process.stdout.write(`  ${m.id || '(sans id)'} · ${m.from || '?'} · ${m.type || '?'} · origine=${m.origine || '—'} · ${statut}\n`);
      for (const a of m.anomalies) process.stdout.write(`    ANOMALIE ${a}\n`);
    }
    const nAnomalies = messages.filter((m) => m.anomalies.length).length;
    process.stdout.write(`  → ${messages.length} message(s), ${nAnomalies} anomalie(s) de format`);
    if (options.blame) process.stdout.write(`, ${messages.filter((m) => m.verifiee === false).length} origine(s) non vérifiée(s)`);
    process.stdout.write('\n');
  }
  return code;
}

module.exports = {
  trouverOuvertures, decouperBlocs, parseChamps, dateValide, deduireOrigine, analyserMessages,
  parseArgs, main, TYPES_VALIDES, ORIGINES_VALIDES,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
