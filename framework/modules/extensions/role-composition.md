# Module : role-composition
> Catégorie : extensions
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : role-personality, self-assessment, direct-spawn, context-budget

## Constat

HOLARCH dispose déjà des instances, des `ROLE.md` et d'un module de posture (`role-personality`). Rien
ne compose en revanche un métier et des compétences réutilisables au moment d'écrire un `ROLE.md` :
chaque parent réinvente sa propre formulation d'une responsabilité déjà rencontrée (développeur
d'API, relecteur qualité, etc.), sans registre partagé ni vocabulaire stable d'une instance à
l'autre. Ce module ajoute un **catalogue de métiers, de compétences et de recettes de rôle** sous
`framework/catalog/`, que le parent consulte à `ON_PLAN` et applique à `ON_SPAWN` pour composer un
`ROLE.md` — sans jamais remplacer les sections natives du gabarit, et sans créer la moindre
permission.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| catalogue_racine | framework/catalog | Répertoire racine du catalogue (index, `jobs/`, `skills/`, `roles/`). |
| max_competences_role | 5 | Nombre maximal de compétences retenues pour un rôle composé. |

## Règles injectées

### ⚓ ON_PLAN
Pour chaque responsabilité envisagée, avant de choisir qui l'assumera :
1. Définis le résultat attendu avant de choisir un métier — le métier sert le résultat, jamais
   l'inverse.
2. Consulte les index du catalogue (`JOBS.md`, `SKILLS.md`, `ROLES.md`, `MATRIX.md`) puis
   uniquement les fiches utiles ; ne charge pas le catalogue complet dans ton contexte.
3. Choisis un métier principal et les compétences nécessaires, ou reprends une recette existante
   (`roles/`) si elle convient telle quelle.
4. Vérifie les prérequis d'exécution des compétences retenues (données, outils, accès, budget) :
   une compétence dont le prérequis manque n'est pas retenue en silence, elle est signalée comme
   limite.
5. Applique les modules de récursion actifs (`self-assessment`, `max-depth`, `instance-budget`, …)
   avant de décider un spawn — une compétence supplémentaire disponible au catalogue ne justifie
   jamais à elle seule la création d'une instance.

Si aucun métier du catalogue ne convient à la responsabilité envisagée, escalade vers ton parent (la
racine sollicite le mainteneur) plutôt que d'improviser une fiche ad hoc ; ne crée jamais
silencieusement une entrée de catalogue pendant une mission — `framework/` reste en lecture seule
pour toute instance (KERNEL §4).

### ⚓ ON_SPAWN
Lors de la rédaction du `ROLE.md` de l'enfant, en plus des sections natives du gabarit (spec §7.2,
toutes obligatoires) :
1. Ajoute une section « Composition professionnelle » citant l'identifiant et la version du métier
   retenu, de la recette éventuelle et de chaque compétence sélectionnée (au plus
   `max_competences_role`), avec la révision Git du catalogue réellement lue.
2. Traduis la méthode et les preuves attendues des compétences en instructions et critères concrets
   pour cette mission précise — jamais une simple recopie des fiches génériques.
3. Reporte les preuves attendues des compétences dans le tableau natif « Livrables » comme critères
   d'acceptation contextualisés : une preuve de compétence non traduite en critère vérifiable est
   une composition incomplète.
4. Inscris le profil de modèle dans « Autorité », comme l'exige déjà `direct-spawn`. Si
   `role-personality` est actif, inscris de même une personnalité valide ; sinon n'en suppose
   aucune.

La composition professionnelle ne crée, à elle seule, aucune permission d'outil, aucun droit
d'écriture et aucune autorité au-delà de ce que « Autorité » énonce déjà explicitement.

### ⚓ ON_WAKE
Si ton propre `ROLE.md` porte une section « Composition professionnelle », applique-la telle
qu'écrite pour toute la session : c'est elle, pas une relecture du catalogue, qui fait foi. Ne relis
le catalogue complet que si ton `ROLE.md` te le demande explicitement ou si une escalade te le
commande ; le catalogue peut avoir évolué depuis ta création, ton contrat non — le KERNEL et les
modules actifs restent prioritaires sur toute règle de métier ou de compétence, et toute
contradiction perçue est signalée à ton parent plutôt que tranchée seul.

### ⚓ ON_CHILD_DONE
Vérifie le livrable de l'enfant contre les critères d'acceptation de son `ROLE.md`, y compris ceux
issus des preuves attendues de ses compétences. Une compétence citée dans la composition n'est pas
une preuve de travail accompli ; une vérification ou un test que le `DELIVERABLE` prétend avoir
exécuté et que tu ne peux pas reproduire n'est pas acceptée sur la base de cette seule déclaration
(KERNEL §5.2).

### ⚓ ON_DELIVER
Pour tout livrable produit sous une composition professionnelle, indique explicitement : ce qui a
été produit, les vérifications réellement exécutées et leur résultat, les vérifications non
exécutées et leur motif, et les limites restantes propres au métier ou aux compétences appliquées.

### ⚓ ON_SLEEP
Consigne dans `MEMORY.md` les preuves de compétence encore manquantes et les prérequis d'exécution
restés indisponibles, pour qu'une reprise n'ait pas à redécouvrir ces manques. Ne modifie jamais
`ROLE.md` en place : tout recadrage de la composition suit la procédure de recadrage du KERNEL
(§10(b)).

## Ce que ce module ne fait pas

Il ne modifie aucune règle des modules d'orchestration, de récursion, de mémoire ou de conflits déjà
actifs — il ajoute une étape de composition à `ON_PLAN`/`ON_SPAWN` et une étape de vérification à
`ON_CHILD_DONE`/`ON_DELIVER`, sur des comportements que le KERNEL et `direct-spawn` autorisent déjà.
Il ne donne à une instance ni la permission d'écrire dans `framework/catalog/`, ni celle de
s'attribuer elle-même un métier ou une compétence : comme le profil de modèle et, si actif, la
personnalité, la composition est une décision du parent à `ON_SPAWN`. Il ne garantit pas la qualité
d'un livrable : une compétence rend une méthode et des preuves attendues explicites, elle ne
dispense pas de la vérification que `ON_CHILD_DONE` impose déjà. Il n'attribue enfin ni diplôme, ni
expérience vécue, ni certification à une instance — une fiche de compétence décrit une méthode
vérifiable, pas une qualification.
