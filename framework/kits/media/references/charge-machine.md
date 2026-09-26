# Charge machine : rendus lourds sans faire tomber la machine

Garantit : les rendus locaux (ffmpeg, super-résolution, synthèse vocale) ralentissent au lieu de saturer la mémoire
et de forcer un redémarrage qui tue toutes les sessions en cours.
Vérifier : `python3 verificateurs/garde-charge.py --a-sec` (décisions sur états simulés), puis
`garde-charge.py --une-fois` en réel : une ligne par processus de rendu vu et l'action décidée.
Sous HOLARCH (module `jobs-et-lots`) : `node framework/bin/holarch-job.js lancer <nom> --lourd -- <commande>` porte déjà
l'admission par jetons machine (`jobs_lourds_max`) et la suspension sous `memoire_libre_min_mo` ; `garde-charge.py`
reste l'outil hors HOLARCH et le contrôle des processus lancés sans job.

## Ce qui arrive sans garde
Trois rendus ffmpeg et une super-résolution lancés en parallèle par deux instances : la mémoire disponible tombe à
zéro, la machine se fige, redémarrage forcé — deux fois dans la même nuit sur une mission. Tout ce qui n'était pas
committé est perdu, et chaque session doit être ré-incarnée.

## Règles
- **Au plus deux ou trois processus lourds en même temps** sur la machine, toutes instances confondues : c'est une
  ressource de la machine, pas de l'instance. Les appels réseau (génératif distant) ne comptent pas.
- **Garde de charge démarré avant le premier rendu** : `nohup python3 verificateurs/garde-charge.py > garde.log 2>&1 &`.
  Il abaisse la priorité des rendus, suspend les plus récents (SIGSTOP) quand la charge ou la mémoire passent le
  seuil, les reprend un par un (SIGCONT) quand la machine respire. Les processus du harnais ne sont jamais touchés.
- **Le seuil mémoire compte plus que la charge** : une charge élevée ralentit, une mémoire épuisée tue.
- `setsid` / `nohup` protègent un rendu de la fin de la session qui l'a lancé, **pas** d'un redémarrage : un rendu
  long écrit par segments validés et publiés un à un (`references/lots-payants.md`, publication atomique), pour
  reprendre au segment et non au début.
- Un rendu suspendu reste suspendu si le garde meurt : vérifier `ps -o stat` (état `T`) avant de conclure qu'un
  rendu « ne progresse plus ».
