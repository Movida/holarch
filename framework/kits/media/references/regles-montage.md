# Règles de montage (photo, son, livrable)

Garantit : chaque règle ci-dessous est vérifiable — par le code qui monte (plancher, anti-répétition) ou par
`verificateurs/qc.py` sur le fichier rendu. Une règle qu'on ne peut pas vérifier est un vœu : ne la mets pas dans
tes `REGLES-OR.md` sans dire où elle se contrôle.
Vérifier : `python3 verificateurs/qc.py <rendu.mp4> --attendu <s> --planche` — une ligne `OK`/`ÉCHEC` par contrôle.

Point de départ pour la table « Règles du métier » d'une instance de montage (`regles-du-metier`) : reprends celles
qui s'appliquent, ajoute celles du brief, garde la colonne « où elle se vérifie ».

## Montage photo
| Règle | Pourquoi | Se vérifie |
|---|---|---|
| Ouvrir sur la meilleure image, pas sur un carton ; le titre vient après ou par-dessus | les premières secondes décident de l'attention | ordre des plans (code de sélection) |
| Fermer sur une image forte, jamais sur un carton nu | on retient la dernière image | ordre des plans |
| Durée de lecture ≥ 2 s par image | en dessous, un visage ne se lit pas | plancher dans le code ; `qc.py` (A3 pour l'excès inverse) |
| Varier la durée selon le contenu ; rythme uniforme = ennui | | durée par nature de plan |
| Jamais deux images de même nature consécutives (lieu, cadrage, mouvement) | effet « dossier qui défile » | règle d'anti-répétition |
| Couper sur les temps forts de la musique dans les passages rapides | une coupe à contretemps se ressent | alignement sur le tempo |
| Un arc (accroche, montée, sommet, chute douce, point final), pas une liste | | ordre des chapitres, relu sur planche |
| Texte dans les marges sûres (≥ 5 % du bord), ≥ 1,5 s à l'écran | téléviseurs et projecteurs rognent | cartons (ci-dessous), planche |
| Aucune image basse définition vue en grand | le flou se voit d'abord | `verificateurs/photos-sources.py` |
| Ni noir pur ni blanc pur en projection (plage 16-235) | détails écrasés, halos | `qc.py` (A10) |

**Cartons** : rends chaque carton en image (une par photogramme clé, à la résolution finale) plutôt qu'en texte
dessiné par le moteur de rendu : la marge sûre, la taille de police et le contraste se relisent alors sur l'image
elle-même, avant le rendu, et une coquille se corrige sans relancer tout le montage.

## Son
| Règle | Se vérifie |
|---|---|
| Loudness intégrée −16 LUFS (projection en salle ; −14 pour une diffusion en ligne), crête vraie ≤ −1 dBTP | `qc.py` (C1), sur le fichier final — voir `references/chaine-audio.md` |
| La voix passe devant la musique : atténuation de 8 à 12 dB sous la parole | écoute + mesure du segment |
| Aucune coupure sèche : fondu ≥ 20 ms à chaque entrée et sortie d'extrait | code d'assemblage |
| Pas de silence > 1,5 s, sauf effet voulu | `qc.py` (C4) |

## Livrable
| Règle | Se vérifie |
|---|---|
| Durée rendue comparée à la durée prévue avant de dire « fait » (un rendu tronqué à 15 % de sa durée est déjà passé inaperçu) | `qc.py --attendu` (D1) |
| Relire le fichier final, pas le storyboard : images extraites à pas régulier et à chaque raccord | `qc.py --planche` (D2) |
| H.264 haut profil, `+faststart`, AAC 192 kbit/s, 1920×1080 : lisible depuis une clé USB sur un téléviseur | `qc.py` (D3) |
| Toujours garder une version jouable pendant qu'on améliore (répertoire versionné, jamais écrasé) | arborescence de sortie |
