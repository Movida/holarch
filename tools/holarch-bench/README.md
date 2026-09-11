# holarch-bench

Banc de mesure à deux étages pour le harnais HOLARCH (`docs/IMPLEMENTATION.md` §6). Sans dépendance
(Node ≥ 18). Fournit l'instrument de mesure — jamais un verdict sur les seuils eux-mêmes.

```
node bench.js --a-sec
node bench.js --reel <mission> --budget-usd <n>
node bench.js --calibrer <fichier-SESSIONS.md> [--unites <dossier mission/>]
node bench.js --calibrer --transcriptions <dossier-de-*.jsonl>
```

## `--a-sec`

Rejoue les sept scénarios de `framework/tests/scenarios/` sur le faux `claude`
(`HOLARCH_FAKE_CLAUDE`, `framework/tests/fake-claude.js`) : zéro appel LLM, zéro dollar. Ajoute une
ligne à `docs/bench/REGISTRE.md` par scénario. **Pas encore livré dans ce paquet** — voir
`RAPPORT.md` du chantier pour l'état exact.

## `--reel <mission> --budget-usd <n>`

Copie `docs/examples/<mission>` (ex. `t3-csvjson-mission`) dans une racine jetable, puis lance
`node framework/bin/holarch-spawn.js --bootstrap` dessus avec un plafond de dépense réel. Coûte de
l'argent — à n'exécuter que volontairement, jamais en boucle ni sans plafond explicite. Ajoute une
ligne à `docs/bench/REGISTRE.md`. **Pas encore livré dans ce paquet** — voir `RAPPORT.md`.

## `--calibrer <SESSIONS.md>`

Le seul mode entièrement livré et vérifié dans ce paquet. Lit un fichier `SESSIONS.md` existant
(10 colonnes, format `mission-holon-v2`, ou 11 colonnes avec la colonne `Réveil` des missions
HOLARCH postérieures) et imprime, sur la sortie standard :

- **Coût USD/session**, **Tours/session**, **Contexte (tokens)**, et — si la colonne existe —
  **Réveil (caractères)** : médiane et p90 de chaque grandeur ;
- **Hibernations/session** : une hibernation = une session de plus qu'une, pour une même valeur de
  colonne `Instance`, dans ce fichier ;
- des **valeurs proposées** pour `budget_usd_par_session` et `seuil_contexte_tokens`, avec leur base
  de calcul imprimée à côté (p90 × marge, ou p90 arrondi) — jamais une valeur nue.

`--calibrer` **n'écrit jamais `CONFIG.md`** : c'est au mainteneur de décider, avec ces chiffres sous
les yeux, si un seuil mérite d'être changé.

### Ventilation par fournisseur

Depuis le chantier 9 (`docs/IMPLEMENTATION.md` §11.2 : « le banc ventile contexte et coût par
fournisseur et par type d'unité ; c'est la mesure qui fondera les choix de modèle »), `--calibrer`
imprime, après les statistiques globales, un bloc par fournisseur : nombre de sessions, coût total et
coût médian, tours, contexte, et les modèles réels vus sous ce fournisseur.

Le groupement lit la colonne `Fournisseur / modèle réel` de `SESSIONS.md` (treizième, ajoutée en
1.14.0), au format `anthropic / claude-opus-5`. Deux règles de lecture, toutes deux délibérées :

- **Colonne absente** (archives et missions antérieures au chantier 9) : la ventilation n'est pas
  imprimée du tout — `null`, pas un bloc à un seul groupe. Un fichier qui ne porte pas l'information
  ne doit pas donner l'illusion d'une mesure mono-fournisseur.
- **Cellule vide, `—` ou `?`** sur une ligne d'un fichier qui a pourtant la colonne : la session est
  groupée sous `fournisseur inconnu`, jamais fondue dans le fournisseur majoritaire. Un mélange de
  lignes anciennes et récentes dans le même fichier se voit alors comme tel.

Les coûts estimés par le catalogue — préfixés d'un `≈` dans `SESSIONS.md`, cas d'un exécuteur qui ne
rapporte pas son coût — sont **comptés** dans les statistiques, et leur nombre est imprimé à côté
(`dont n estimé(s) « ≈ » par le catalogue`) : les ignorer ferait disparaître des statistiques toute
session passée par une passerelle, ce qui était le comportement avant 1.14.0 ; les compter sans le
dire donnerait à une estimation le même poids visuel qu'une mesure.

### Ventilation par type d'unité

`--calibrer` lit aussi les fiches d'unité (`memoire/U<n>-….md`, module `unites-indexees`) sous la
racine de mission déduite du chemin du `SESSIONS.md` donné, ou sous le chemin passé à `--unites
<racine>`. Il imprime, par type : nombre de fiches, répartition des résultats (`PASS`, `PARTIEL`,
`FAIL`), nombre d'instances concernées et Δ de contexte médian quand les fiches le portent (ligne
`contexte:` du module `delegation-intra-session`). Le **coût par type d'unité n'est pas calculé** et
la sortie le dit en toutes lettres : `SESSIONS.md` compte par session, une session porte une à trois
unités et ne dit pas laquelle a coûté quoi — le ventiler supposerait une répartition inventée.

**Ce que « type » désigne, et pourquoi c'est une lecture tolérante** : §11.2 parle d'une colonne
`type` « déjà présente » dans la fiche d'unité — elle ne l'est pas. `UNITE.template.md` porte `id`,
`date`, `critere`, `resultat`, `preuve`, `commit`, `tags`, et `mode: directe|déléguée` quand
`delegation-intra-session` est actif. Plutôt que d'inventer un champ ou de renoncer à ventiler, le
banc lit `type:` si l'instance en écrit un, sinon `mode:`, sinon range la fiche sous
`non renseigné`. L'ordre de préférence est écrit ici pour qu'un lecteur de la sortie sache de quoi
elle parle : sur une mission qui ne renseigne rien, le groupe unique `non renseigné` est le résultat
honnête, pas une panne.

Aucune fiche trouvée (racine sans `memoire/`, ou `--transcriptions` sans `--unites`) : le bloc n'est
pas imprimé, comme pour la ventilation par fournisseur.

### Colonnes reconnues

Le tableau `SESSIONS.md` est parsé par **nom** de colonne (recherche insensible à la casse par
sous-chaîne), jamais par position : les formats à dix et onze colonnes coexistent dans les archives
et ce paquet doit reconnaître les deux sans configuration.

- `Coût USD` → nombre, **`≈` compris** (coût estimé par le catalogue, 1.14.0 : le signe est retiré
  avant lecture, la valeur est comptée et le nombre d'estimations est rapporté à part). Vide, `?` ou
  `—` → ignoré (absence de mesure, pas un zéro) — dont le cas d'un modèle sans tarif au catalogue,
  journalisé sans coût plutôt qu'à `0,00`.
- `Tours` → nombre, même règle d'absence.
- `Tokens (entrée/cache lu/cache écrit/sortie)` → `entrée + cache lu + cache écrit` (sortie
  exclue), exactement la formule du hook `context-watch`
  (`framework/hooks/holarch-hooks.js`, `contextWatch`) — pour calibrer `seuil_contexte_tokens` sur la
  grandeur que ce hook surveille réellement, pas sur un proxy inventé pour ce banc.
- `Réveil (car. système/utilisateur)` → somme des deux composantes, si la colonne existe. Absente du
  format à dix colonnes (`mission-holon-v2`, antérieur à ce champ) : la statistique associée n'est
  alors simplement pas imprimée.
- `Instance` → sert uniquement au décompte des hibernations (regroupement par valeur, pas par
  contiguïté : deux instances peuvent s'entrelacer dans le temps dans un même fichier).

### Ce que `--calibrer` ne fait pas

- Il ne calcule pas `reserve_usd` : `SESSIONS.md` ne consigne que le coût total d'une session déjà
  terminée, jamais le budget **restant** au moment précis où elle a hiberné — la grandeur que
  `reserve_usd` borne. Fabriquer un nombre depuis un proxy aussi indirect serait moins honnête qu'une
  case vide expliquée (KERNEL §5.4). Voir
  `framework/modules/recursion/reserve-hibernation.md`, section « Ce que ce module ne fait pas ».
- Il ne distingue pas, dans le décompte des hibernations, une hibernation de contexte, un
  changement de régime ou une reprise après crash : les trois ré-incarnent une même `Instance` et
  sont donc comptés de la même façon. Une lecture fine par cause exigerait la colonne `Note`
  (texte libre, non structuré) — hors périmètre de ce banc.
- Il ne juge pas si un chiffre est bon ou mauvais : les « valeurs proposées » sont un calcul
  reproductible sur l'échantillon donné, pas une recommandation qui engagerait le banc à la place du
  mainteneur.

## Tests

`node --test test-bench.js` : fonctions élémentaires (parsing de cellule, médiane/p90), parsing des
deux formats de tableau, `calibrer()` sur un jeu de données synthétique calculé à la main, et un test
de **non-régression** sur l'archive réelle `docs/archive/mission-holon-v2/registry/SESSIONS.md`
(tolérance 1 % sur les grandeurs statistiques — l'archive elle-même ne change plus). Ce dernier test
se saute silencieusement (`skip`, avec motif) si l'archive n'est pas trouvée depuis l'emplacement du
fichier : le paquet peut vivre à deux profondeurs différentes (sous `mission/shared/...` avant
promotion, sous `tools/holarch-bench/` après), `test-bench.js` remonte l'arborescence pour
retrouver l'archive dans les deux cas.

## Registre (`docs/bench/REGISTRE.md`)

Chaque exécution de `--a-sec` ou `--reel` (jamais `--calibrer`, qui ne mesure rien de nouveau) ajoute
une ligne à ce fichier append-only, dix colonnes exactement :
`date · hash framework · étage · scénario ou mission · USD · tours · réveils · contexte de réveil
moyen · hibernations/session · verdict`.
