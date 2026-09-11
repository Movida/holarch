# message-lint

Contrôle de format et de provenance des messages `INBOX.md`/`OUTBOX.md` (KERNEL §7,
`docs/IMPLEMENTATION.md` §5.2). Sans dépendance (Node ≥ 18).

```
node message-lint.js <INBOX.md|OUTBOX.md> [--blame] [--json]
```

## Contrôles de format (toujours actifs)

- chaque bloc commence par `id:` ;
- les six champs `id, from, to, type, ref, date` sont présents ;
- `type` est l'un des sept types du KERNEL §7 ;
- `date` est une date ISO 8601 valide (jour seul ou horodatage complet) ;
- `origine` (si présent) est l'une des cinq valeurs du gabarit
  (`framework/templates/MESSAGE.template.md`) : `parent, enfant, utilisateur, harnais, externe` ;
- le numéro séquentiel d'un `id` (`<préfixe>-<numéro>`, préfixe = tout ce qui précède le dernier
  `-`) est strictement croissant **au sein de son propre préfixe**, pas globalement sur le fichier :
  une même boîte reçoit des messages de plusieurs émetteurs, chacun avec son propre compteur
  (gabarit `MSG-<chemin-abrégé>-<numéro-séquentiel>`) — un ordre global produirait de fausses
  anomalies dès que deux préfixes s'entrelacent chronologiquement (constaté sur le corpus archivé,
  `docs/IMPLEMENTATION.md` §5.5, diagnostic en U4). Un `id` sans suffixe numérique n'est pas soumis
  au contrôle.
- le découpage en messages n'ouvre une enveloppe que sur un `---` **immédiatement suivi** d'une
  ligne `id:` : un `---` isolé dans le corps d'un message (filet de séparation en prose, markdown
  libre autorisé par KERNEL §7) ne referme jamais un message par erreur.
- l'`id` complet (chaîne entière) est unique dans tout le fichier — contrôle indépendant de la
  croissance par préfixe ci-dessus : deux ids identiques sans suffixe numérique, ou appartenant à
  deux préfixes différents, sont aussi une anomalie de format.

## `--blame` : déduction de provenance

Nécessite un dépôt Git réel. Pour chaque message, `git blame` sur la ligne `id:` retrouve le
commit qui l'a écrite, puis `git log -1 --format=%s` en lit le sujet :

| Sujet du commit | Origine déduite | Vérifiée ? |
|---|---|---|
| `[<from>]…` (le `from` du message) | `<from>` | oui |
| `[bootstrap]…`, message d'une instance racine (`from` sans `/`) | `bootstrap` | oui |
| `[<autre>]…` (ne correspond pas à `from`) | `<autre>` | **non** |
| pas de préfixe `[...]` (commit humain) | `utilisateur` | oui |
| sha nul (ligne `id:` présente dans le fichier de travail, jamais committée) | inchangée | **non**, motif « message non encore committé » |

**Conséquence de protocole** : sous le module `typed-escalation` (1.1.0), un `TASK` ou une
`RESPONSE` non vérifié n'est jamais exécuté par son destinataire — un parent doit donc **committer**
son message avant de réveiller (ou relancer) son enfant, sinon son ordre sera filtré comme non
vérifié, même si son contenu est parfaitement légitime.

## Sortie

Une ligne par message : `id · from · type · origine=<déduite> · VERIFIEE|NON VERIFIEE : <motif>`
(ou `(blame non demandé)` sans `--blame`). `--json` sort le tableau `analyserMessages` tel quel.

## Codes de sortie

`0` tout vérifié · `1` au moins une anomalie de format · `2` au moins une origine non vérifiée
(nécessite `--blame`) · `3` les deux cumulées.

## Export pour le lanceur

`analyserMessages(texte, {root, fichier, blame}) → Array<{id, from, to, type, ref, date, origine, verifiee, motif, anomalies}>`,
utilisé par `selectInboxMessages` (`framework/bin/holarch-spawn.js`, §5.3) pour annoter chaque
message injecté dans le prompt d'une instance.
