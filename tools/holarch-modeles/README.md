# holarch-modeles

Paquet de deux outils indépendants, sans dépendance externe ni accès réseau (sauf mention
contraire) : `lecture-openrouter.js` transforme un JSON `GET /api/v1/models` d'OpenRouter en lignes
de catalogue HOLARCH candidates ; `jointure.js` croise les fiches d'unité des instances d'une
mission avec les lignes de son `registry/SESSIONS.md`, pour répondre à « quelle session a produit
quelle unité, à quel coût ».

## lecture-openrouter.js

### À quoi ça sert

Lit un JSON au format de `GET https://openrouter.ai/api/v1/models` (soit un objet `{ "data": [...] }`,
soit directement un tableau d'entrées) et rend, sur la sortie standard, des lignes de catalogue
HOLARCH candidates — une par entrée retenue, prêtes à être reprises manuellement dans un catalogue de
modèles.

### Invocation

```
node lecture-openrouter.js --source <fichier.json|url> [--motif <regex>] [--date <AAAA-MM-JJ>]
```

- `--source <fichier.json|url>` : obligatoire. Chemin de fichier local, ou URL `http(s)://`.
- `--motif <regex>` : optionnel, filtre les entrées dont le champ `id` correspond à l'expression
  régulière donnée (`^deepseek/` par exemple) ; absent, toutes les entrées sont rendues.
- `--date <AAAA-MM-JJ>` : optionnel, fixe la date affichée dans la ligne d'en-tête ; absente, le jour
  courant en UTC.

Chaque option accepte aussi la forme `--option=valeur`. Sans `--source`, l'outil écrit l'usage sur
l'erreur standard et sort avec le code 2.

### Format de sortie

Une ligne de commentaire d'en-tête suivie d'une ligne de catalogue par entrée retenue, par exemple
pour l'entrée `deepseek/deepseek-v4.1-flash` :

```
<!-- source : fiche.json · lu le 2026-09-12 -->
| deepseek-v4.1-flash@openrouter | openrouter | deepseek/deepseek-v4.1-flash | low…high | 0,15 / 0,6 / — / 0,003 | — | — | 200000 |
```

Colonnes de la ligne de catalogue : identifiant court (dernier segment de `id`, suffixé
`@openrouter`), fournisseur (`openrouter`), identifiant complet OpenRouter, plage de qualité
(toujours `low…high`, à ajuster à la main), coûts USD par million de tokens (prompt / complétion,
puis écriture cache / lecture cache si l'entrée porte au moins un champ de cache — deux colonnes
supplémentaires uniquement dans ce cas), deux colonnes laissées à `—` (réservées), longueur de
contexte. Les tarifs sont convertis d'USD par token vers USD par million de tokens et formatés avec
virgule décimale, sans zéro inutile ; une valeur non convertible s'écrit en tiret cadratin (`—`).

### Comportement sans réseau

Le module ne fait un appel réseau que si `--source` est une URL `http(s)://` (via `fetch`) ; toute
autre valeur est lue comme un chemin de fichier local (`fs.readFileSync`), sans jamais toucher le
réseau. Les tests de ce paquet n'utilisent que la fixture locale `exemples/openrouter-models.json`.

### Limites connues

- Lit une URL `http(s)://` seulement si on lui en donne une explicitement en `--source` ; sinon,
  traitement exclusif en fichier local — aucune détection automatique, aucun réglage réseau caché.
- La plage de qualité (`low…high`) et les deux colonnes réservées (`—`) sont des espaces réservés :
  l'outil ne calcule ni ne devine ces valeurs, à compléter à la main dans le catalogue final.
- Un champ de tarification absent ou non numérique produit un tiret cadratin, sans avertissement.

## jointure.js

### À quoi ça sert

Croise les fiches d'unité (`memoire/U<n>[suffixe]-<slug>.md`) d'une mission avec les lignes de son
`registry/SESSIONS.md`, pour répondre à « quelle session a produit quelle unité, à quel coût ».
Fonctionne sur une mission vivante (`mission/`) ou archivée (`docs/archive/mission-<nom>/`), seule
l'arborescence important (`registry/SESSIONS.md` à la racine, instances en sous-répertoires
quelconques avec chacune un `memoire/`) ; aucun accès réseau, aucune dépendance externe.

### Invocation

```
node tools/holarch-modeles/jointure.js --mission <racine> [--format table|json] [--instance <chemin>]
```

- `--mission <racine>` : obligatoire.
- `--format table|json` : optionnel, défaut `table` ; toute autre valeur → code 2.
- `--instance <chemin>` : optionnel, filtre sessions et fiches sur l'instance dont le chemin
  relatif à la racine de mission est **exactement** égal à la valeur (égalité stricte, pas de
  préfixe : `--instance concepteur` exclut les fiches/sessions de `concepteur/implementeur-x`).

Codes de sortie : `0` succès, `2` arguments invalides / mission introuvable / `SESSIONS.md` absent.

### Sortie

#### Format `table` (défaut)

Ligne de commentaire d'en-tête `<!-- mission : <racine> · <n> session(s) · <n> fiche(s) -->` (nombre de fiches = total, rattachées et non rattachées).

Table des sessions, une ligne par session (ordre de `SESSIONS.md`) :

| colonne | origine |
|---|---|
| fin | `Date` de la ligne de session (fin de session) |
| instance | `Instance` |
| modèle / effort | `Modèle / effort` |
| tours | `Tours` brut (`?` si illisible) |
| coût USD | `Coût` brut (`?` si illisible, `≈ …` conservé si approximatif) |
| contexte départ/max | `Contexte (départ / max)`, `— / —` si absent (colonne ajoutée tardivement) |
| unités | `id:` des fiches rattachées, séparés par virgules, `—` si aucune |
| coût/unité | coût session ÷ nb fiches rattachées, arrondi à 2 décimales ; `—` sinon |

Table des fiches non rattachées (omise si toutes rattachées) : `fiche` (chemin relatif), `instance`, `id`, `date` (champ `date:` de la fiche), `motif` (`aucune session pour cette instance` ou `hors de tout intervalle de session`).

Ligne finale : `<n> session(s) · <n> tours · <n> USD · <n> fiche(s) rattachée(s) sur <n>`.

#### Format `json`

Objet à quatre clés de premier niveau (pas trois : `mission`, `sessions`, `totaux`, plus `fiches_non_rattachees`) :
- `mission` : valeur brute passée à `--mission`.
- `sessions` : un objet par session (valeurs parsées + leur `_brut`), plus `fiches` (fiches
  rattachées, champs bruts du frontmatter : `id`, `date`, `critere`, `resultat`, `preuve`, `commit`,
  `tags`, `instance`, `chemin`), `unites` (liste des `id`), `cout_par_unite`.
- `fiches_non_rattachees` : tableau de `{fiche, motif}`.
- `totaux` : `{sessions, tours, cout_usd, fiches_rattachees, fiches_total}`.

### Clé de jointure

`Date` de `SESSIONS.md` est la **fin** de session (écrite à la mort de la session). L'intervalle
d'une session vaut `[Date − Durée, Date]`. Une fiche (même instance) est rattachée à la session dont
l'intervalle contient sa date `date:`, bornes comprises ; en cas de chevauchement, la fin la plus
proche l'emporte — jamais de rattachement multiple.

### Exemple

```
node tools/holarch-modeles/jointure.js --mission docs/archive/mission-holarch-delegation --instance concepteur --format table
```

Sortie réelle (vérifiée le 2026-09-12) :
```
<!-- mission : docs/archive/mission-holarch-delegation · 2 session(s) · 5 fiche(s) -->

| fin | instance | modèle / effort | tours | coût USD | contexte départ/max | unités | coût/unité |
|---|---|---|---|---|---|---|---|
| 2026-09-11T11:11:24Z | concepteur | claude-opus-5 3.1141+claude-sonnet-5 0.1293/high | 57 | 3.2434 | 62431 / 107749 | U1, U2 | 1.62 |
| 2026-09-11T12:49:58Z | concepteur | claude-opus-5 5.5432+claude-sonnet-5 0.7428/high | 48 | 6.2860 | 60812 / 152541 | U3 | 6.29 |

2 session(s) · 105 tours · 9.53 USD · 3 fiche(s) rattachée(s) sur 5
```

Sans `--instance`, la même mission donne 8 sessions et 16 fiches (6 rattachées) ;
`docs/archive/mission-holarch-fournisseurs` donne 16 sessions et 39 fiches.

### Limites connues

- Fiche à cheval sur deux intervalles : « fin la plus proche » gagne, sans trace de l'ambiguïté.
- Fiche sans date lisible, ou session sans `Durée`/`Date` lisible : rattachement impossible, silencieusement — motif générique `hors de tout intervalle de session`, indiscernable d'une fiche réellement hors intervalle.
- Mission sans `registry/SESSIONS.md` : erreur propre (code 2), pas de sortie partielle.
- Colonnes de `SESSIONS.md` ajoutées après coup (`Contexte`, `Fournisseur / modèle réel`) : lignes anciennes plus courtes obtiennent `null`, à condition que les colonnes manquantes soient en fin de ligne (aucune insérée au milieu à ce jour).
- Ne détecte ni fiches dupliquées (même `id`) ni lignes de session dupliquées.

## Tests

```
node --test tools/holarch-modeles/test-lecture-openrouter.js tools/holarch-modeles/test-jointure.js
```

17 tests, `pass 17`, `fail 0` (exécuté le 2026-09-12) : 7 tests pour `lecture-openrouter.js`
(fixture locale `exemples/openrouter-models.json`, aucun accès réseau) et 10 pour `jointure.js`
(fixtures hermétiques, répertoire temporaire par cas, nettoyé ensuite ; aucun test ne lit
`docs/archive/`).

---

Note d'emplacement : ce README suppose l'emplacement promu de l'outil, `tools/holarch-modeles/` ; dans le paquet livrable il se trouve provisoirement sous `mission/shared/concepteur/cible-tools/holarch-modeles/` (garde-fou interdisant à la mission tout chemin ayant `tools` pour segment).
