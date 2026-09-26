'use strict';
// Extraction vers un kit (chantier 17, §17.2) : `archive.js --kit <domaine>` propose de reprendre les `REGLES-OR.md`
// des instances et les vérificateurs publiés sous `shared/**/verificateurs/` dans `framework/kits/<domaine>/`.
// Geste du mainteneur, jamais automatique : sans `--appliquer`, rien n'est écrit ; avec, les fichiers sont copiés
// (jamais d'écrasement, refus global si une destination existe), chaque référence ouverte par `<!-- à relire -->`
// (un kit reformule, il ne recopie pas : `config-lint --kits` refusera la pièce tant qu'elle n'a pas été reprise).
// Aucun commit, aucune suppression.
const fs = require('fs');
const path = require('path');

const IGNORES = new Set(['.holarch', '.git', 'node_modules', 'workspace']);

function parcourir(dir, visite) {
  let entrees;
  try { entrees = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) parcourir(p, visite);
    else if (e.isFile()) visite(p);
  }
}

/** Propositions `{ source, destination }` (chemins relatifs à `depot`) pour un domaine de kit. */
function proposer(depot, domaine, source = 'mission') {
  const racine = path.join(depot, source);
  const kit = path.join('framework', 'kits', domaine);
  const props = [];
  // Une instance est un répertoire qui porte un ROLE.md : `shared/<chemin>/verificateurs/` seulement pour ce chemin-là
  // (un kit en cours de fabrication sous `shared/…/kits/<d>/verificateurs/` n'est pas repris).
  const estInstance = (segments) => segments.length > 0 && fs.existsSync(path.join(racine, ...segments, 'ROLE.md'));
  parcourir(racine, (p) => {
    const rel = path.relative(racine, p).split(path.sep);
    if (rel[rel.length - 1] === 'REGLES-OR.md' && rel[0] !== 'shared' && estInstance(rel.slice(0, -1))) {
      const instance = rel.slice(0, -1).join('-');
      props.push({ source: path.relative(depot, p), destination: path.join(kit, 'references', `${instance}-REGLES-OR.md`), relire: true });
    } else if (rel[0] === 'shared' && rel[rel.length - 2] === 'verificateurs' && estInstance(rel.slice(1, -2))) {
      props.push({ source: path.relative(depot, p), destination: path.join(kit, 'verificateurs', rel[rel.length - 1]), relire: false });
    }
  });
  return props;
}

/** Refus (liste de motifs) : domaine invalide, destination déjà présente, deux sources vers la même destination. */
function refus(depot, domaine, props) {
  const motifs = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(domaine || '')) motifs.push(`domaine invalide (kebab-case attendu) : ${domaine}`);
  const vues = new Set();
  for (const { destination } of props) {
    if (vues.has(destination)) motifs.push(`deux sources pour ${destination} : renommer l'une avant extraction`);
    vues.add(destination);
    if (fs.existsSync(path.join(depot, destination))) motifs.push(`destination existante, jamais écrasée : ${destination}`);
  }
  return motifs;
}

function appliquer(depot, props) {
  for (const { source, destination, relire } of props) {
    const cible = path.join(depot, destination);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    const contenu = fs.readFileSync(path.join(depot, source));
    fs.writeFileSync(cible, relire ? `<!-- à relire -->\n${contenu}` : contenu);
    if (!relire) fs.chmodSync(cible, fs.statSync(path.join(depot, source)).mode);
  }
}

/** Point d'entrée de `archive.js --kit` : 0 proposition affichée ou appliquée, 1 refus. */
function executerKit({ depot, domaine, source, appliquer: ecrire }, sortie = process.stdout, erreur = process.stderr) {
  const props = proposer(depot, domaine, source || 'mission');
  const motifs = refus(depot, domaine, props);
  if (motifs.length) { erreur.write(`Refus, rien n'a été écrit :\n${motifs.map((m) => `  ${m}`).join('\n')}\n`); return 1; }
  if (!props.length) { sortie.write(`Aucun REGLES-OR.md ni vérificateur publié sous ${source || 'mission'}/ : rien à proposer.\n`); return 0; }
  for (const p of props) sortie.write(`${ecrire ? 'copié ' : 'proposé'} : ${p.source} → ${p.destination}${p.relire ? ' (à relire)' : ''}\n`);
  if (ecrire) {
    appliquer(depot, props);
    sortie.write(`${props.length} fichier(s) copié(s), aucun commit : reformuler, compléter INDEX.md, puis config-lint --kits.\n`);
  } else {
    sortie.write(`${props.length} proposition(s), aucune écriture : relancer avec --appliquer pour copier.\n`);
  }
  return 0;
}

module.exports = { proposer, refus, executerKit };
