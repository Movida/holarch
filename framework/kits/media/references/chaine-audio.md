# Chaîne audio : loudnorm deux passes → WAV → AAC

Garantit : un fichier final dont la loudness et la crête sont celles demandées, parce qu'on les **mesure sur le
fichier livré** et pas sur un intermédiaire.
Vérifier : `python3 verificateurs/qc.py <final.mp4>` — contrôle C1 (loudness intégrée et crête vraie).

## Ce que le modèle fait mal sans cette note
- Une seule passe de `loudnorm` travaille en mode dynamique : la loudness intégrée dérive de ±1 à 2 LU et la
  dynamique est écrasée. La normalisation linéaire exige **deux passes** : la première mesure, la seconde applique
  les valeurs mesurées.
- L'encodeur AAC fait remonter la crête (reconstruction inter-échantillons) : une piste à −1 dBTP en WAV peut sortir
  à −0,3 dBTP en AAC. D'où une cible de crête un peu plus basse à l'étape 2, et la mesure **après** encodage.
- Normaliser chaque extrait séparément puis les assembler ne donne pas un tout normalisé : on normalise le mixage.

## Chaîne
1. Mixage final (voix, musique, effets) exporté en WAV PCM 48 kHz — pas de format compressé intermédiaire.
2. Passe 1, mesure : `ffmpeg -i mix.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -`
   → relever `input_i`, `input_tp`, `input_lra`, `input_thresh`, `target_offset`.
3. Passe 2, application : même filtre avec `measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true`,
   sortie WAV 48 kHz.
4. Encodage : `-c:a aac -b:a 192k`, multiplexé avec la vidéo (`-c:v copy` si la vidéo est déjà finale),
   `-movflags +faststart`.
5. Mesure sur le fichier final (`qc.py`, ou `ffmpeg -i final.mp4 -af ebur128=peak=true -f null -`) : −16 ± 2 LUFS,
   crête vraie ≤ −1 dBTP. Hors borne : on reprend à l'étape 2, jamais à l'œil.

## Pièges
- `linear=true` est ignoré sans erreur si la plage demandée est inatteignable : ffmpeg repasse en dynamique.
  Le seul juge est la mesure de l'étape 5.
- Une piste stéréo dont un canal est muet mesure 3 LU trop bas ; vérifier les canaux avant.
