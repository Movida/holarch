---
name: holarch-session
description: Démarre ou clôt efficacement une session de maintenance HOLARCH (pas une instance) — lecture minimale au démarrage, passation en fin de session, hygiène de la mémoire persistante. Utiliser en début de session ("où en est-on", "reprends", "état", "relance"), avant de rendre la main ("on change de session", "passation", "stoppe pour une autre session"), ou quand le contexte reçu au démarrage a semblé insuffisant.
---

# Une session de maintenance HOLARCH, du premier au dernier message

Principe : **un fait, une place**. Ce qui décrit l'état vit dans le hook de démarrage (`tools/holarch-session/etat.js`),
ce qui est une règle vit dans `CLAUDE.md` ou `docs/ENVIRONNEMENT.md`, ce qui est une procédure vit dans un skill, ce
qui est une leçon ou un point de reprise vit dans la mémoire persistante. Une information au mauvais endroit se
perd (mémoire jamais relue) ou coûte à chaque session (règle relue dix fois).

## 1. Au démarrage : quatre sources, dans cet ordre, rien de plus

1. **La ligne d'état injectée** (`[HOLARCH · état du dépôt …]`) : branche, arbre, mission et état effectif des
   instances, **paramètres clés** (`mode_attente`, `isolation`, budget, tours, seuil), processus vivants, coût,
   messages qui attendent le mainteneur, versions. Ne pas la reconstituer en relisant `mission/`.
2. **La mémoire « HOLARCH current state »** (index `MEMORY.md`) : où la dernière session s'est arrêtée, ce qu'elle
   attendait du mainteneur, la commande de reprise. Puis seulement les notes thématiques que la tâche appelle
   (lancement, promotion/publication, pièges de patch).
3. **Le skill de la tâche** : `holarch-iterate` (lancer), `holarch-supervise` (suivre), `holarch-pause` (arrêter),
   cycle promote/archive/open (`docs/ENVIRONNEMENT.md` §11).
4. **Les fichiers ciblés** : `grep` puis `sed -n` ; sous-agent `Explore` pour tout balayage. Jamais `docs/holarch.md`
   ni une archive en entier ; `npm run observe` une fois plutôt que dix `cat`.

Si la ligne d'état montre une alerte (« session vivante (tuée ?) », tâche au pid mort, message pour le mainteneur),
elle se traite avant tout lancement ; après un redémarrage du conteneur, `node framework/bin/holarch-spawn.js --reprendre`.

## 2. Pendant la session

- Décider et agir sur les gestes réversibles ; réserver au mainteneur ce que `docs/ENVIRONNEMENT.md` §7 lui réserve
  (push du modèle, fusion dans `main` d'une branche de mission…) et lui tendre la commande prête.
- Tout changement d'outillage, de convention ou de décision se reflète dans le même commit dans le fichier qui le
  décrit (`docs/ENVIRONNEMENT.md` §12) ; tout changement de `framework/` publié incrémente `framework/VERSION` et
  `CHANGELOG.md` ; `npm test`, `npm run lint`, `--dry-run` avant de committer un changement du harnais.
- Noter au fil de l'eau, dans le scratchpad, ce qui a manqué au contexte de départ et ce qui a été découvert :
  c'est la matière de la passation, pas quelque chose à reconstruire de mémoire au dernier message.
- Après tout push ou publication : `gh run list` sur le dépôt concerné (`main` et tag), avant de rendre compte.

## 3. En fin de session : la passation

Avant de rendre la main, ou dès que le mainteneur annonce un changement de session :

1. **Mémoire « current state »** réécrite, pas complétée : date et heure absolues, HEAD attendu, état de la mission
   (instances, sessions, coût), ce qui attend le mainteneur (commandes prêtes), commande de reprise. Vingt lignes
   suffisent ; ce que le dépôt ou `git log` racontent déjà n'y a pas sa place.
2. **Leçons** dans la note thématique qui existe (lancement, promotion/publication, pièges de patch), jamais dans la
   note d'état ; une note qui dépasse ~40 lignes se découpe par thème, une note devenue fausse se supprime.
   Une ligne par note dans `MEMORY.md`, à jour.
3. **Ce qui aurait dû être dans le contexte de départ** est remis à sa place, dans le même commit : un fait d'état
   manquant → une ligne dans `etat.js` (avec son test) ; une règle → `CLAUDE.md` ou `ENVIRONNEMENT.md` ; une
   procédure → le skill concerné ; une leçon → la mémoire.
4. **Idées** : chaque amélioration entrevue et non faite devient une ligne datée de `docs/IDEES.md` (gain, effort,
   état `ouverte`) ; une idée réalisée passe à `faite` avec son commit. C'est ce que la session suivante voit dans sa
   ligne « suivi » au démarrage, et ce qui fait évoluer l'outillage en continu sans attendre un chantier.
5. **Arbre propre** (hors fichiers d'instance et journal du lanceur, qui appartiennent à l'instance), rien de
   promis dans le dernier message qui ne soit fait.

## 4. Coûts de contexte connus, à éviter

- Le skill `claude-api` se charge en entier (~15 000 tokens) au moindre mot-clé « prix », « modèle », « Claude » :
  ne l'invoquer que pour écrire du code contre l'API ; pour un tarif, une recherche web ciblée suffit.
- Une note de mémoire de 60 lignes lue pour trois faits ; une archive ou `docs/holarch.md` lus en entier ; une
  relecture de `mission/` à chaque message de l'utilisateur alors qu'un `Monitor` est armé.
- Un `sleep` en premier plan pour attendre une session : `Monitor` ou Bash en arrière-plan avec une boucle `until`.
- Trente réveils du moniteur pour des hibernations de routine : superviser avec `--evenements --mainteneur`.

## 5. Compaction du contexte

Le hook `PreCompact` (`tools/holarch-session/passation.js`, entrée dans `.claude/settings.json`) dicte au résumé ce
qu'il doit conserver : état de la mission, gestes du mainteneur en attente avec leurs commandes, commits non poussés,
fichiers modifiés, moniteurs armés, dernières décisions de l'utilisateur. Après une compaction : `npm run etat` et la
mémoire « current state » avant tout geste.
