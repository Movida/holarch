# Module : delegation-budget
> Catégorie : recursion
> Version : 1.1.0
> Requiert : —
> Incompatible avec : —
> Complète bien : instance-budget, context-budget, reserve-hibernation, direct-spawn, heartbeat-log

## Constat

`instance-budget` borne le nombre d'**instances** d'une mission et `max-depth` leur profondeur.
`context-budget` borne l'accumulation de **contexte** dans une session. Aucune règle du catalogue ne
voit les délégations à des **sous-agents `Agent`** — que le KERNEL encourage pourtant explicitement
(§5.8 : « déléguer les lectures volumineuses à un sous-agent en lecture seule ») et que le lanceur
autorise par défaut (`outils_cli` contient `Agent`, `direct-spawn`).

**Ce que coûte une délégation a été mesuré deux fois, par deux voies indépendantes, pas supposé**
(KERNEL §5.4).

*Voie 1 — le rappel de budget, de l'intérieur de la session.* Une session lancée par le lanceur
reçoit après chaque appel d'outil un rappel `USD budget: $X/$5; $Y remaining` (`--max-budget-usd` ;
constat déjà documenté par `reserve-hibernation`). En isolant un tour ne contenant **qu'un** appel
`Agent`, la session de conception de ce module a relevé sur son propre compteur :

| Tour | Contenu du tour | Coût cumulé (USD) | Delta |
|---|---|---|---|
| 2 | 1 `Write` + 1 `Bash` | 0.304739 | 0.1915 |
| 3 | 1 `Write` + 2 `Read` (~200 lignes) | 0.4077655 | 0.1030 |
| **4** | **1 seul appel `Agent` (sous-agent `sonnet`, ~1000 lignes lues)** | **0.8344418** | **0.4267** |
| 5 | 1 `Read` (22 lignes) + 1 `Grep` | 0.9853833 | 0.1509 |
| 6 | 1 `Bash` (script node sur 45 fichiers JSON) | 1.0860788 | 0.1007 |
| 7 | 1 `Bash` (script node sur une transcription) | 1.2176988 | 0.1316 |

Tours ordinaires : 0,10 à 0,19 USD. Tour de délégation : 0,4267, soit une part imputable au
sous-agent d'**au moins 0,235 USD** (en attribuant au tour lui-même le plus coûteux des tours
ordinaires observés) et d'environ 0,28 USD par rapport au tour ordinaire médian — pour **une**
délégation cadrée, en lecture seule, sur un périmètre borné à l'avance.

*Voie 2 — le résultat de session, de l'extérieur.* Le lanceur enregistre le résultat brut de chaque
session dans `mission/.holarch/sessions/<instance>-<horodatage>.result.json`. Le champ `modelUsage` y
est **décomposé par modèle**, `costUSD` compris. Pour la session ci-dessus (`num_turns` = 15,
`total_cost_usd` = 1,5649) :

| Modèle | Rôle | costUSD | Tokens (sortie / cache lu / cache écrit) |
|---|---|---|---|
| `claude-opus-5` | la session elle-même | 1,2936 | 26 733 / 374 845 / 43 779 |
| `claude-sonnet-5` | **le sous-agent délégué** | **0,2713** | 8 342 / 277 794 / 52 897 |

Les deux voies concordent : 0,2713 USD mesuré mécaniquement, contre 0,235–0,28 estimé de
l'intérieur. **Le coût d'un sous-agent est donc bien inclus dans la dépense de la session qui le
lance, et il est chiffrable après coup, exactement, quand le sous-agent tourne sur un modèle
distinct de celui de la session.** Sur les 57 résultats de session journalisés dans cette mission,
un seul présente plusieurs modèles dans `modelUsage` : celui-là.

Trois conséquences, de natures différentes :

1. **La dépense déléguée est bornée, mais par un fusible qui tue sans laisser de trace.** Un
   sous-agent ne crée aucun budget : il consomme celui de la session qui l'a lancé, déjà plafonnée
   par `--max-budget-usd`. Ce qu'il change, c'est la **granularité** de la consommation : un appel
   d'outil unique a coûté ici près de trois tours ordinaires — et davantage pour une délégation
   ouverte, non bornée par un périmètre de lecture explicite. Une session qui surveille sa réserve
   d'hibernation tour par tour (`reserve-hibernation`) peut donc traverser cette réserve **en un
   seul pas** et être coupée à `error_max_budget_usd` : `STATUS.md` reste à `WORKING`, `MEMORY.md`
   n'est pas écrit, la session suivante repart de l'état d'avant. C'est ce qui est arrivé à la
   session de conception de ce module.
2. **La trace mécanique existe déjà, mais elle est conditionnelle et à demi jetée.** `modelUsage`
   porte l'attribution exacte ; le lanceur n'en conserve dans `registry/SESSIONS.md` que les *noms*
   des modèles joints par `+` (`claude-opus-5+claude-sonnet-5`), sans les coûts, et en filtrant
   `haiku`. Un parent qui lit `SESSIONS.md` peut donc constater **qu'**une session enfant a délégué,
   pas **combien** — et seulement si le sous-agent tournait sur un autre modèle.
3. **Une session peut rendre sa propre délégation visible, ou invisible, par un choix qu'elle
   contrôle** : le modèle du sous-agent. C'est le point d'appui de ce module — la seule chose qu'une
   règle normative puisse faire ici est d'agir sur ce que la session décide, au moment où elle
   décide.

## Pourquoi un module distinct, et non un amendement à `instance-budget`

Deux raisons, dont une mécanique :

- **Le nombre n'est pas la dépense.** Une délégation mesurée à 0,27 USD et dix micro-délégations
  peuvent coûter l'inverse l'une de l'autre. Un compteur de sous-agents calqué sur le compteur
  d'instances donnerait un chiffre exact et sans rapport avec la ressource consommée.
- **Le champ « Budget alloué / consommé » de la fiche registre est lu par un garde-fou mécanique**
  (`spawn-guard`, branché sur `PreToolUse`/`Bash`, vérifie « alloué > 0 » et « consommé ≤ alloué »
  avant d'autoriser l'incarnation d'un enfant). Y mélanger des délégations auto-déclarées ferait
  dépendre une décision de hook d'une donnée qu'aucun hook ne vérifie, et rendrait ininterprétable
  le seul compteur d'instances aujourd'hui fiable. Les deux grandeurs restent séparées :
  `instance-budget` compte des enveloppes de budget créées, ce module surveille la consommation
  d'une seule enveloppe.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| marge_delegation_usd | 0.5 | Montant (USD) exigé **en plus** de la réserve d'hibernation avant d'autoriser une nouvelle délégation à un sous-agent (règle `ON_SUPERVISE`). Défaut calibré sur la mesure du Constat : une délégation cadrée en lecture seule a coûté 0,27 USD ; 0,5 laisse un peu moins du double, sans prétendre couvrir une délégation ouverte (voir « Ce que ce module ne fait pas »). Si `reserve-hibernation` n'est pas actif, la réserve à laquelle cette marge s'ajoute est celle que la session s'est fixée elle-même à `ON_ORIENT`. |
| modele_sous_agent_distinct | oui | Si « oui », toute délégation doit être adressée à un modèle **différent de celui de la session**, et différent de `haiku` (règle `ON_SUPERVISE`), afin que le sous-agent apparaisse dans `modelUsage` et donc dans la colonne modèle de la ligne `registry/SESSIONS.md` écrite par le lanceur. « non » dispense de cette contrainte : la délégation redevient indiscernable en agrégat, et seule l'auto-déclaration en garde trace. |
| trace_delegations | oui | Si « oui », chaque délégation donne lieu à une ligne d'événement dans le flux d'observabilité partagé (`mission/registry/PROGRESS.md`, si un module d'observabilité à flux partagé est actif) et à une mention dans le bilan de fin de session (règles `ON_SUPERVISE` et `ON_SLEEP`). Si « non », les délégations ne sont tracées qu'au bilan d'`ON_SLEEP` — rétrogradation assumée : une session coupée brutalement ne laisse alors aucune trace auto-déclarée de ses délégations. |
| plafond_delegations_session | — | Nombre maximal de délégations par session, annoncé à `ON_ORIENT` et opposable à `ON_SUPERVISE`. **Aucun plafond par défaut, délibérément** : le nombre est un mauvais proxy de la ressource consommée (voir ci-dessus). Une mission qui veut malgré tout borner le nombre — par exemple pour cadrer une instance dont on soupçonne qu'elle délègue par réflexe plutôt que par besoin — renseigne un entier, et la règle s'applique **en plus** du critère en USD, jamais à sa place. |

## Règles injectées

### ⚓ ON_ORIENT
Consigne dans ton plan de session, avant de commencer à travailler :

1. Le montant restant lu sur le dernier rappel de budget reçu, ou la mention explicite « aucun
   rappel de budget observé » si aucun n'apparaît après tes premiers appels d'outil. Dans ce second
   cas, note que la règle en USD d'`ON_SUPERVISE` restera **sans objet** pour la session : ce module
   lit un signal, il ne l'instrumente pas, et n'a aucune heuristique de repli à te proposer.
2. La marge que tu t'imposes (`marge_delegation_usd`) et, s'il est renseigné,
   `plafond_delegations_session`. Exemple : « réserve d'hibernation 1,2 USD + marge de délégation
   0,5 → je ne lance aucun sous-agent en dessous de 1,7 USD restants, et pas plus de N au total ».
3. Un compteur de délégations initialisé à 0 pour la session (ou repris de `MEMORY.md` si tu
   reprends après une hibernation volontaire — le compteur est **par session**, pas cumulatif sur
   l'instance : c'est le budget de session qu'il protège).

### ⚓ ON_SUPERVISE
**Avant chaque appel à un sous-agent `Agent`** — donc au moment où tu en décides, seul instant où
une règle peut encore t'engager :

- Lis le montant « remaining » du dernier rappel de budget (ne l'extrapole pas). Si
  `remaining < réserve d'hibernation + marge_delegation_usd`, **ne lance pas la délégation** : soit
  tu fais la lecture toi-même si elle tient dans ton contexte restant, soit tu la reportes en la
  consignant dans `MEMORY.md` comme prochaine action pour la session suivante. Le refus de déléguer
  est ici la position par défaut, pas l'exception : c'est le pas de consommation le plus large dont
  tu disposes, et le seul qui puisse traverser ta réserve en une fois.
- Si `plafond_delegations_session` est renseigné et que ton compteur l'a atteint, ne délègue plus :
  fais le travail toi-même, ou émets un `BLOCKER` motivé, comme pour un budget d'instances épuisé.
- Si `modele_sous_agent_distinct = oui`, **impose explicitement au sous-agent un modèle différent du
  tien** (paramètre `model` de l'outil `Agent`), et jamais `haiku`. Deux raisons qui vont dans le
  même sens : une lecture cadrée, en lecture seule, ne demande pas le modèle d'une session de
  conception (devoir d'économie, KERNEL §5.8) ; et c'est la seule action à ta portée qui rende ta
  délégation **mécaniquement** visible de l'extérieur — elle apparaîtra dans `modelUsage`, donc dans
  la colonne modèle de la ligne que le lanceur écrira dans `registry/SESSIONS.md`. `haiku` est exclu
  parce que le lanceur le filtre de cette colonne (`direct-spawn` le réserve par ailleurs aux
  sous-agents de lecture, mais la trace, elle, n'y survit pas).
- **Borne la délégation dans son énoncé** : périmètre de lecture explicite (fichiers ou répertoires
  nommés, volume attendu) et consigne de sortie courte. Une délégation dont tu ne peux pas énoncer
  le périmètre est une délégation dont tu ne peux pas estimer le coût — c'est le cas que la marge
  par défaut ne couvre pas.

**Après chaque délégation** : lis à nouveau le montant restant, incrémente ton compteur, et note la
**différence entre les deux relevés**. Cette différence inclut le coût de ton propre tour : elle
majore le coût du sous-agent — dis-le ainsi quand tu la rapportes, plutôt que de la présenter comme
le coût du sous-agent (l'écart entre les deux voies était de 0,04 à 0,16 USD sur la délégation
mesurée au Constat). Si `trace_delegations = oui`, ajoute une ligne au flux partagé
d'observabilité :
`<ISO 8601> · <ton chemin> · ON_SUPERVISE · delegation <n> : <objet en trois mots> (modèle <m>, delta observé <X> USD)`.

### ⚓ ON_SLEEP
Écris dans ton bilan de fin de session — `MEMORY.md` (section *État courant* ou *Points de
vigilance*) et, si `trace_delegations = oui`, une ligne du flux partagé — **le nombre de délégations
de la session, les modèles employés et le total des deltas observés**, même si ce nombre est zéro :
« 0 délégation » est une information utile à un parent qui vérifie un livrable, « rien d'écrit » ne
l'est pas.

N'inscris **pas** ces montants dans le champ « Budget alloué / consommé » de ta fiche registre : ce
champ est lu par un garde-fou mécanique et ne compte que des instances (voir « Pourquoi un module
distinct »). C'est le bilan de session, pas la comptabilité d'instances, qui porte cette
information.

## Par quel artefact l'information circule — et jusqu'où

La règle « le parent vérifie, pendant que son enfant travaille, combien de sous-agents celui-ci a
lancés » est **non tenable** : un module est un texte normatif, il ne prescrit qu'à la session qui
le lit, au moment où elle le lit ; aucune session ne peut observer l'intérieur d'une autre. Ce
module ne l'exige donc jamais. Ce qu'il fait, c'est agir sur les artefacts écrits qui, eux,
traversent la frontière des sessions :

| Artefact | Ce qu'il porte | Écrit par | Lu par | Fiabilité |
|---|---|---|---|---|
| `mission/.holarch/sessions/*.result.json`, champ `modelUsage` | le coût **exact** par modèle, donc la part déléguée si le sous-agent tourne sur un autre modèle | le lanceur, à la fin de la session | tous, après coup | **mécanique** ; conditionnée au choix de modèle, que la règle `ON_SUPERVISE` ci-dessus rend délibéré |
| `registry/SESSIONS.md`, colonne modèle | le **fait** qu'une session a employé plusieurs modèles (`opus+sonnet`), sans les montants, `haiku` filtré | le lanceur, à la fin de la session | tous, dont le parent avant d'accepter un livrable | mécanique, mais non chiffré |
| Flux d'observabilité partagé (`PROGRESS.md`) | une ligne par délégation : objet, modèle, delta observé | la session délégante, au moment de la délégation | tous, y compris le parent **pendant** que l'enfant travaille | auto-déclaré ; survit à une coupure brutale (append immédiat) |
| Bilan `ON_SLEEP` (`MEMORY.md`) | total de la session | la session délégante, à la fin | son futur soi, son parent | auto-déclaré ; **perdu** si la session est coupée avant `ON_SLEEP` |

D'où la position exacte de ce module : il ne rend pas la délégation *empêchable* (rien ne l'empêche),
mais il la rend **non dissimulable en agrégat** même quand la session est négligente ou coupée —
parce que la trace décisive est écrite par le lanceur, pas par elle. Le détail par délégation, lui,
reste auto-déclaré.

## Ce que ce module ne fait pas

- **Il n'empêche aucune délégation.** Aucun hook du harnais n'intercepte l'outil `Agent` (les hooks
  existants portent sur `Bash`, `Write|Edit` et la fin de session). Une session qui ignore ces
  règles délègue autant qu'elle veut, jusqu'au fusible dur `--max-budget-usd`. C'est un garde-fou
  volontaire, exactement au même titre que le compteur auto-rapporté de `context-budget`.
- **Il ne rend pas la trace mécanique inconditionnelle.** Elle repose sur une règle que la session
  peut ne pas suivre : un sous-agent lancé sur le **même** modèle que sa session se fond dans la même
  entrée de `modelUsage` et devient indiscernable, en coût comme en existence. `haiku` est visible
  dans le fichier de résultat brut mais filtré de `registry/SESSIONS.md`. Ce module déplace
  l'invisibilité d'un cran, il ne la supprime pas.
- **Il ne fournit aucun coût par sous-agent pris isolément.** `modelUsage` agrège par *modèle*, pas
  par délégation : deux sous-agents sur le même modèle ne sont pas séparables l'un de l'autre. La
  seule granularité par délégation reste le delta de deux relevés du rappel de budget, qui majore.
- **Il ne dit rien du contexte consommé par un sous-agent**, et ne le prétend pas : c'est précisément
  l'intérêt de la délégation (le contexte du sous-agent n'entre pas dans celui du parent, KERNEL
  §5.8) et la raison pour laquelle déléguer reste souvent le bon choix malgré ce que borne ce module.
  Il ne décourage pas la délégation : il en borne le déclenchement quand le budget est bas, en impose
  la traçabilité, et la trace toujours.
- **Il est partiellement inerte hors du lanceur.** Sans `--max-budget-usd`, aucun rappel de budget
  n'existe et la règle en USD est sans objet ; sans le lanceur, ni `SESSIONS.md` ni les fichiers de
  résultat ne sont écrits. Restent applicables : le plafond en nombre, la règle de bornage de
  l'énoncé, le bilan `ON_SLEEP`, et la règle de modèle distinct — dont l'effet de trace, lui,
  disparaît.
- **Il ne mesure pas l'ampleur du phénomène qu'il borne.** Sur les 57 résultats de session
  journalisés dans cette mission, un seul montre plusieurs modèles. C'est compatible avec « la
  délégation à un sous-agent a été rarissime ici », et c'est la lecture que je retiens ; mais une
  délégation au même modèle serait invisible dans ce comptage, donc le chiffre est un **plancher**,
  pas une mesure. Quelle part de la dépense d'une mission passe réellement par des sous-agents reste
  inconnue. Les défauts de ce module sont calibrés sur **une** délégation mesurée, pas sur une
  distribution : ce sont des points de départ à recalibrer, pas des valeurs établies.
