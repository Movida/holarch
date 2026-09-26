# Module : milestone-reviews
> Catégorie : extensions
> Version : 1.1.0
> Requiert : —
> Incompatible avec : —
> Complète bien : direct-spawn, fork-join, heartbeat-log, typed-escalation, regles-du-metier

## Constat

Le KERNEL (§2) déclenche déjà `ON_CHILD_DONE` « à chaque livrable d'enfant », mais dans la pratique un enfant qui travaille sur plusieurs sessions ne produit souvent qu'un seul `DELIVERABLE` : le final. Le parent découvre alors une dérive de trajectoire (mauvaise interprétation du `ROLE.md`, choix de conception discutable, périmètre débordé) au pire moment — après tout le travail fait, plutôt qu'à mi-parcours quand une correction coûte peu. `heartbeat-log` (si actif) rend cette dérive *visible* a posteriori dans `registry/PROGRESS.md`, mais ne force personne à la *regarder* avant la fin : c'est un journal d'événements auto-rapportés, pas une vérification. Ce module comble cet écart en rendant obligatoire, pour les enfants dont le travail le justifie, un découpage en jalons intermédiaires **vérifiés un par un** par le parent, avec la même rigueur que la livraison finale (devoir de supervision, KERNEL §5.2) — sans attendre `DELIVERED`.

1.1.0 (chantier 17, `docs/IMPLEMENTATION.md` §17.4) : quand le livrable est un **artefact** destiné à un tiers (média, document, code livré), le parent qui vérifie un jalon relit ce qu'il a lui-même cadré, et le producteur défend ce qu'il a fait — aucun des deux ne lit l'artefact avec les yeux du commanditaire. Une instance distincte, de profil `relecture`, qui ne reçoit que les mots du commanditaire, les références et l'échantillon validé, relit chaque jalon d'artefact sur pièces avant que le parent ne l'accepte.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| jalons_seuil | 3 | Nombre de lignes dans la table « Livrables » du `ROLE.md` d'un enfant au-delà duquel `ON_SPAWN` rend obligatoire un découpage en jalons intermédiaires. |
| jalons_min | 2 | Nombre minimal de jalons intermédiaires à déclarer dans la section « ## Jalons » d'un `ROLE.md` soumis à ce découpage. |
| delai_relance_jalon | 2 | Nombre de sessions de l'enfant écoulées sans nouveau `DELIVERABLE` de jalon ni `BLOCKER`, au-delà duquel `ON_SUPERVISE` déclenche une vérification de dérive silencieuse. |

## Règles injectées

### ⚓ ON_SPAWN
Après avoir appliqué la mécanique structurelle invariante de spawn (KERNEL §9), compte les lignes de la table « Livrables » du `ROLE.md` que tu viens de rédiger pour cet enfant. Si ce nombre est strictement supérieur à `jalons_seuil`, ou si tu estimes toi-même — quel que soit ce compte — que le travail de cet enfant dépassera vraisemblablement une seule session, ajoute à son `ROLE.md` une section `## Jalons` listant au moins `jalons_min` jalons intermédiaires ordonnés (identifiants `J1`, `J2`, …), chacun avec un critère d'acceptation vérifiable propre, distinct des critères d'acceptation finaux déjà présents dans la table « Livrables ». Consigne ce découpage, et sa justification, dans ton `JOURNAL.md`. Si le travail tient manifestement dans une seule session, n'ajoute aucun jalon — un découpage forcé sur une tâche courte est un coût de coordination sans contrepartie (devoir d'économie, KERNEL §5.8).

**Relecture distincte.** Si un livrable de l'enfant est un artefact (son `ROLE.md` a une section « Validations requises »), crée aussi, par la même mécanique, sa sœur `<nom>-relecture` : profil `relecture`, budget d'instances compté. Son `ROLE.md` recopie les mots exacts du commanditaire, les références et l'échantillon validé (porte V1), et prescrit de relire **sur pièces** — contrôles rejoués par `--controle`, planche ou extraits, jamais l'artefact entier élément par élément — puis de rendre, par jalon, un `DELIVERABLE` : verdict, défauts, règles violées. Si tu produis toi-même l'artefact, la relecture est ton enfant direct `relecture`.

### ⚓ ON_SUPERVISE
Pour chaque enfant dont le `ROLE.md` déclare une section `## Jalons`, ne te contente pas d'attendre son `DELIVERABLE` final : dès qu'un `DELIVERABLE` reçu dans ton `INBOX.md` référence un jalon (`ref` ou corps du message mentionnant un identifiant `J<n>` qui n'est pas le dernier de la liste), traite-le immédiatement au hook `ON_CHILD_DONE` plutôt que de le laisser attendre dans l'`INBOX.md` jusqu'à la fin de la mission de l'enfant. Si `delai_relance_jalon` sessions de cet enfant se sont écoulées depuis le dernier jalon franchi (ou depuis son spawn, si aucun jalon n'a encore été franchi) sans nouveau `DELIVERABLE` de jalon ni `BLOCKER` reçu, considère-le en dérive silencieuse : consulte son `STATUS.md` et, si `heartbeat-log` est actif, `registry/PROGRESS.md`, avant de décider s'il faut le relancer par `TASK` ou attendre encore une session.

### ⚓ ON_CHILD_DONE
Quand le `DELIVERABLE` traité référence un jalon intermédiaire (identifié `J<n>`, non le dernier de la section « ## Jalons » de son `ROLE.md`), vérifie-le contre le critère d'acceptation propre à ce jalon — pas contre les critères d'acceptation finaux de la table « Livrables », qui ne s'appliquent qu'à la fin. Réponds par `RESPONSE` : soit une acceptation explicite du jalon (l'enfant poursuit vers le jalon suivant dans sa prochaine session), soit une demande de correction référençant le jalon concerné (message `TASK`, l'enfant doit corriger avant de poursuivre). Ne fais rien d'autre à ce stade : ne compile aucun livrable, ne publie rien dans `shared/`, ne fais pas progresser le `STATUS.md` de l'enfant vers `DELIVERED` — cela reste réservé au traitement du dernier jalon (ou de l'unique `DELIVERABLE`, pour un enfant sans section « ## Jalons »), qui suit le cycle KERNEL habituel (`ON_CHILD_DONE` puis `ON_DELIVER`) sans particularité de ce module.

Un jalon d'artefact (final compris) n'est accepté qu'avec le `DELIVERABLE` de sa relecture, postérieur au sien : à sa réception, adresse à la relecture un `TASK` pointant le jalon et lance-la ; un défaut bloquant qu'elle relève devient un `TASK` correctif au producteur, qui la cite. `holarch-observe` signale un jalon accepté sans relecture (anomalie `jalon-sans-relecture`).

## Ce que ce module ne fait pas

Il n'invente aucun nouveau type de message : un jalon se signale avec un `DELIVERABLE` ordinaire (KERNEL §7), simplement référencé à un identifiant `J<n>` plutôt qu'au livrable final — le protocole de messages n'est pas modifié, seulement sa cadence d'usage. Il ne mesure et ne journalise aucun événement par lui-même (ce rôle reste celui de `heartbeat-log`, qui peut rester actif ou non, indépendamment de celui-ci) : il ne fait que rendre obligatoire, pour les enfants dont le travail le justifie, la vérification intermédiaire que le KERNEL permettait déjà mais ne rendait pas systématique. Il ne fournit aucun mécanisme pour forcer un enfant récalcitrant à respecter son propre découpage en jalons — un enfant qui ignore sa section « ## Jalons » et ne produit qu'un `DELIVERABLE` final reste détectable (l'absence de `DELIVERABLE` de jalon dans les temps déclenche la vérification de dérive silencieuse d'`ON_SUPERVISE`), mais la correction relève du jugement du parent (`TASK` correctif, voire recadrage KERNEL §10), pas d'une règle mécanique supplémentaire. La relecture distincte (1.1.0) ne remplace pas la vérification du parent (contrôles rejoués, KERNEL §5.2) : elle l'éclaire d'un regard qui n'a pas cadré le travail ; `jalon-sans-relecture` est une anomalie d'information, jamais un refus mécanique.
