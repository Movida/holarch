# Kit `media` — montage photo, film généré, son

Garantit : une instance de production audiovisuelle part avec ce qu'une mission a appris et payé — règles
vérifiables, chaîne audio, limites des services génératifs, lots reprenables, garde de charge — sous forme de notes
courtes, de blocs de prompt et de vérificateurs exécutables.
Vérifier : `npm run lint:kits` (forme du kit, `--help` et `--a-sec` de chaque vérificateur) ; sur un livrable,
`python3 verificateurs/qc.py <rendu.mp4> --attendu <s>`.

**Domaine** : montage de photos en vidéo, clips générés par image vers vidéo, mixage et normalisation du son,
livraison d'un fichier lisible sur téléviseur ou vidéoprojecteur. Dérivé du retour d'expérience d'une mission de
montage (diagnostic du 2026-09-20 et matériau `media-prep` archivé), reformulé et rendu générique.

## Quand attacher
- Le livrable d'une instance est une vidéo, un montage, une bande son, ou un lot d'images ou de clips générés.
- L'instance appelle un service génératif payant (image, vidéo, voix) ou lance des rendus locaux lourds.
- Pas pour une instance qui ne fait que rédiger un scénario sans rien produire : la note `regles-montage.md`
  suffit alors, citée dans son `ROLE.md`.

Attache : ligne `- Kits : media` du « Contexte hérité » du `ROLE.md` (ou des Ressources d'`OBJECTIVE.md`).

## Lire à `ON_ORIENT` (pas tout d'un coup)
1. Toujours : `references/regles-montage.md` — base de la table « Règles du métier » (`regles-du-metier`).
2. Selon le travail de la session, la seule note utile ci-dessous ; les vérificateurs se lancent, ils ne se lisent pas.

## Pièces
| Pièce | Ce qu'elle apporte |
|---|---|
| `references/regles-montage.md` | règles photo, son, livrable, chacune avec son lieu de vérification ; cartons en image |
| `references/chaine-audio.md` | loudnorm deux passes → WAV → AAC, crête mesurée sur le fichier final |
| `references/image-vers-video.md` | règle du premier photogramme, arc temporel, identité, limites Kling (2 500 car., 422) |
| `references/lots-payants.md` | échantillon puis devis, reprise par empreinte, publication atomique, un acteur par lot |
| `references/charge-machine.md` | rendus lourds : plafond machine, garde de charge, ce que `setsid` ne protège pas |
| `references/photos-sources.md` | normalisation d'album, basse définition, bandes, super-résolution non générative |
| `prompts/image-cle.md` | bloc de prompt de l'image clé = premier photogramme, identité constante |
| `prompts/image-vers-video.md` | bloc de prompt vidéo : une action, arc, caméra nommée, négatif |
| `verificateurs/qc.py` | contrôle d'un rendu : durée attendue, conteneur, loudness, silences, noirs, plans figés, planche |
| `verificateurs/garde-charge.py` | garde de charge machine : priorité, suspension et reprise des rendus |
| `verificateurs/lot-plans.py` | devis avant lot, limites de prompt, reprise par empreinte (`--marquer`) |
| `verificateurs/photos-sources.py` | verdict par photo : définition, bandes, orientation |

## Dépendances des vérificateurs
Python 3 ; `ffmpeg`/`ffprobe` pour `qc.py`, Pillow pour `photos-sources.py` — en mode réel seulement : `--help` et
`--a-sec` n'en ont pas besoin. Outil absent en mode réel : code 2 et message, jamais un faux `OK`.

## Limites de ce kit
- Les limites de services sont datées (2026-09) : la veille les revérifie avant un lot (ligne `Veille` de la fiche registre, U0 de `regles-du-metier`).
- Rien ici ne remplace l'échantillon validé par le décideur avant de multiplier (porte déclarée).
- Hors kit : clonage de voix et données personnelles — jamais dans un kit partagé.
