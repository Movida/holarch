# Module : jobs-et-lots
> Catégorie : extensions
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : direct-spawn, regles-du-metier, unites-indexees, heartbeat-log

## Constat

Dans la mission de montage vidéo qui a fait naître ce module (`docs/diagnostics/2026-09-20-retex-montage-video-pacs.md`),
un rendu `ffmpeg` lancé en arrière-plan par une session est mort avec elle, un lot génératif a été payé deux fois
(2,45 USD) par une instance qui n'avait pas lu son INBOX, et deux rendus lourds simultanés ont saturé la machine. Le
harnais sait désormais porter ces travaux hors de la session (`framework/bin/holarch-job.js`, docs/IMPLEMENTATION.md
§18.4-18.6) : un superviseur détaché, une admission par jetons machine, un lot payant verrouillé, devisé et repris par
empreinte. Ce module oblige l'instance à s'en servir, et à regarder ce qui tourne déjà avant de relancer.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| job_duree_min | 2 | Durée attendue (minutes) au-delà de laquelle une commande passe par `holarch-job lancer`. |
| motifs_lourds | ffmpeg, blender, melt, magick | Commandes lourdes (virgules : une cellule de table ne porte pas `\|`) : toujours en job `--lourd` ; `observe` signale `lourd-hors-job`. |
| jobs_lourds_max | 2 | Jetons machine : jobs lourds simultanés, toutes missions de la machine confondues ; au-delà, file d'attente. |
| memoire_libre_min_mo | 3000 | Plancher de mémoire libre : en dessous, pas d'admission, et le plus récent des jobs lourds est suspendu (jamais le seul en cours). |
| job_silence_max_min | 10 | Journal et progression immobiles au-delà : anomalie `job-sans-progres` (`observe`). |
| budget_services_usd | 0 | Budget des services payants de la mission (USD) ; à 0, tout lot dont le devis est non nul est refusé. |

## Règles injectées

### ⚓ ON_WAKE
Avant de relancer quoi que ce soit, `node framework/bin/holarch-job.js liste --proprietaire <ton chemin>` : un job
`en-cours`, `en-file` ou `suspendu` se suit (`etat`, `journal`), il ne se relance pas ; un job au superviseur mort passe
par `holarch-job reprendre` (relancé s'il était `--reprenable`, sinon clos `interrompu`), jamais par une nouvelle commande. Un lot se relance tel quel : ses éléments déjà
faits sont sautés (un seul élément en échec rend le job `echoue`), et un lot tenu par un autre est refusé avec le nom de son détenteur — c'est la réponse, pas un
obstacle à contourner.

### ⚓ ON_ORIENT
Toute commande attendue au-delà de `job_duree_min` minutes ou nommée dans `motifs_lourds` passe par
`holarch-job lancer <nom> [--lourd] --sortie <chemin> --valider '<commande {fichier}>' -- <commande…>` : la sortie
n'est publiée qu'après validation. Tout appel à un service payant passe par un lot (`framework/templates/LOT.template.json`) :
`holarch-job lot <fichier> --devis` d'abord, le devis cité dans ton fichier de règles du métier (`REGLES-OR.md`) s'il
existe, puis `holarch-job lot <fichier>`. Jamais `&`, `nohup` ni `setsid` à la main, jamais un appel payant hors lot.

### ⚓ ON_SUPERVISE
Pour attendre un job, pose `WAITING_CHILDREN` avec `Réveil : lun(job:<id>, message:BLOCKER, message:ALERT)` et hiberne :
le superviseur te réveille à sa fin. Superviseur mort (redémarrage, OOM) : aucun réveil avant `--reprendre` du
mainteneur (job `interrompu`, te réveille), `observe` le signale. Un job en cours n'empêche jamais d'hiberner.

### ⚓ ON_SLEEP
Committe les lignes de `mission/registry/COUTS-SERVICES.md` écrites par tes lots (`sleep-guard` refuse la fin de
session sinon) ; consigne dans `JOURNAL.md` les jobs encore en cours, avec leur id.

## Ce que ce module ne fait pas

Il n'installe aucun démon : l'admission et la suspension se jouent au lancement et pendant la supervision de chaque
job (§18.5). Il ne retire pas les clés des services payants de l'environnement de la session : un appel payant hors
lot reste possible, `lourd-hors-job` n'en voit que la partie machine (hors périmètre, §18.8). Il ne fixe pas le prix
d'un service : le devis additionne les `cout_estime_usd` déclarés par l'instance, et le coût réel est celui que la
commande imprime (sinon l'estimation, marquée « ≈ » au registre).

Il n'accepte pas n'importe quel gabarit dans un lot : `{fichier}` (sortie produite, connue seulement à la validation)
est réservé à `valider`, `{sortie}` à `commande` ; `{entree:n}` doit désigner une entrée de l'élément et
`{param:k}` une valeur scalaire de `parametres`. Un gabarit sans valeur fait refuser le lot avant devis, jamais un appel payant
avec « undefined » (seconde revue n° 27).
