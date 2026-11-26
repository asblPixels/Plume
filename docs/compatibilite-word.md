# Plume et Microsoft Word : protocole d'interopérabilité

## Objectif et limites

Plume reste un logiciel indépendant de Pixel's ASBL. L'objectif est
l'interopérabilité documentaire, non une reproduction de Word.

Format prioritaire : DOCX (Office Open XML / ISO/IEC 29500).
L'interface, le nom, les logos, les ressources et le code de Microsoft Word
ne sont ni copiés ni nécessaires. La mention « Microsoft Word » désigne
uniquement le logiciel avec lequel la compatibilité est recherchée.

Une compatibilité parfaite, notamment pour la pagination, les polices
indisponibles, les objets Office avancés ou les fonctions propriétaires,
ne peut pas être présumée.

## Protocole d'aller-retour

1. Prendre un document de test avec une origine et des droits d'usage connus.
2. Conserver une copie immuable du DOCX de référence.
3. Ouvrir le document avec Plume; modifier une zone définie, puis exporter en DOCX.
4. Lancer l'audit des parties XML, relations et objets incorporés :

   \`python3 tests/audit_docx_roundtrip.py original.docx apres-plume.docx --json\`

5. Vérifier la sortie dans Microsoft Word : absence de réparation,
   contenu, styles, pagination, tableaux, notes, commentaires, modifications
   suivies, sections, en-têtes et pieds, images, objets et champs.
6. Réouvrir dans Plume, vérifier que les modifications de Word sont conservées.
7. Consigner les différences voulues et les défauts observés séparément.

Le code retour 0 de l'audit signifie *absence d'erreurs structurelles
détectées*, **pas** une garantie d'identité visuelle ou fonctionnelle.
Un retrait volontaire de partie ou une nouvelle structure équivalente
peut déclencher un avertissement; une suppression d'objet opaque déclenche
une erreur pour éviter les pertes silencieuses.

Exécuter les tests unitaires sans dépendance externe :

\`python3 -m unittest discover -s tests -p 'test_audit_docx_roundtrip.py' -v\`

## Compatibilité prioritaire

| Zone | Attente | Vérification |
| --- | --- | --- |
| Texte, styles et listes | Lecture et écriture sans perte | Word / OOXML |
| Sections et en-têtes | Géométrie et références préservées | Word / OOXML |
| Commentaires et révisions | État, auteurs et marques conservés | Word / OOXML |
| Tableaux et pagination | Pas de cellule perdue, rendu cohérent | Word / LibreOffice |
| Images, graphiques et objets | Pas de suppression silencieuse | Audit / Word |
| Polices | Pas de redistribution sans autorisation | Inventaire licences |

## Licences et propriété intellectuelle

- S'appuyer sur les formats et spécifications publiés, et sur une
  implémentation indépendante.
- Ne pas reprendre le code, les modèles, les visuels, les marques
  graphiques, ni les fichiers binaires de Microsoft Office.
- Vérifier séparément les licences de chaque police : droit de
  distribution, d'incorporation et éventuelles restrictions de sous-ensemble.
  L'obscurcissement \`.odttf\` n'est **pas** une autorisation de redistribution.
- N'ajouter aux tests que des fichiers dont l'usage et la diffusion
  sont permis. Éviter les données personnelles réelles.
- Préserver les fonctions originales de Plume (travail local/hors ligne,
  polices pédagogiques autorisées, accessibilité et formats alternatifs).

## Travaux encore nécessaires

L'audit ajouté ici est structurel. La fidélité de l'affichage, la
préservation de toutes les modifications d'un DOCX complexe et la
compatibilité réelle avec Word nécessitent un corpus de tests,
des captures de comparaison, puis des corrections ciblées des moteurs
d'import/export et de pagination. Aucune validation complète dans
Microsoft Word n'est revendiquée à cette étape.

## Recette du candidat Windows

Le [candidat Windows](https://github.com/asblPixels/Plume/pull/5) est vérifié par
le workflow **Plume Windows - aperçu installable**. Le runner exécute les
tests Node et vérifie le manifeste avant de compiler l’installateur NSIS.
Il vérifie ensuite l’installation par utilisateur, l’ouverture de la
fenêtre, le refus d’une mise à jour pendant une session active, la fermeture
normale et la désinstallation. Un nouveau commit annule la recette
précédente de la même PR lorsqu’elle tourne encore. L’installateur non
signé est disponible dans les artefacts du run réussi.

Pour la recette dans Microsoft Word, utiliser des copies et vérifier ces cas :

| Cas | Résultat attendu à la réouverture dans Word |
| --- | --- |
| Champ texte Word simple dans un paragraphe | Le contrôle conserve son nom, sa balise et sa valeur. Tester également le texte indicatif et les retours à la ligne. |
| Case à cocher Word moderne dans le corps | L’état choisi dans Plume est conservé, ainsi que les glyphes et les propriétés de verrouillage. |
| Document .docm ou modèle .dotm | Le projet VBA est conservé. Plume affiche le code et les procédures détectées. L’exécution manuelle passe par Word sur Windows. |
| PDF retouché | Le texte pris en charge reste extractible hors de la modification. Comparer le rendu dans un lecteur PDF indépendant. Les pages retouchées restent rasterisées. |

Les listes déroulantes, les dates, l’exécution VBA dans Plume et la fidélité
des PDF complexes restent à valider ou à développer avant la publication
finale. L’audit DOCX en CI vérifie la structure du fichier. La réouverture
dans Word vérifie le comportement du document et sa mise en page.
