# Plume

Plume est le traitement de texte de **Pixel’s ASBL**. Il permet de rédiger, modifier et partager des documents Word, OpenDocument et PDF. Il fonctionne sans compte ni abonnement. L’application de bureau fonctionne hors ligne.

[Ouvrir Plume en ligne](https://asblpixels.github.io/Plume/) · [Télécharger Plume 1.4.1](https://github.com/asblPixels/Plume/releases/tag/v1.4.1)

## Choisir son édition

| Appareil | Édition |
| --- | --- |
| Navigateur | [Ouvrir Plume en ligne](https://asblpixels.github.io/Plume/) |
| Windows x64 | [Installateur EXE](https://github.com/asblPixels/Plume/releases/download/v1.4.1/Plume-Setup-1.4.1-x64.exe) · [Version portable ZIP](https://github.com/asblPixels/Plume/releases/download/v1.4.1/Plume-Portable-1.4.1-x64.zip) |
| macOS | [Apple Silicon](https://github.com/asblPixels/Plume/releases/download/v1.4.1/Plume-1.4.1-mac-arm64.dmg) · [Intel](https://github.com/asblPixels/Plume/releases/download/v1.4.1/Plume-1.4.1-mac-x64.dmg) |
| Linux x64 | [AppImage, DEB, RPM, Snap et Flatpak](https://github.com/asblPixels/Plume/releases/tag/v1.4.1) |
| Android | [APK à installer directement](https://github.com/asblPixels/Plume/releases/download/v1.4.1/Plume-1.4.1-android-debug.apk) |
| iPhone et iPad | [Ouvrir dans Safari](https://asblpixels.github.io/Plume/) · [IPA non signée](https://github.com/asblPixels/Plume/releases/download/v1.4.1/Plume-1.4.1-ios-non-signee.ipa) |

Les paquets Windows et macOS sont distribués sans signature de l’éditeur. L’APK porte une signature de débogage. La [page de version](https://github.com/asblPixels/Plume/releases/tag/v1.4.1) fournit les sommes SHA‑256.

## Ce que Plume permet de faire

- **Rédiger et mettre en page** des lettres, rapports et formulaires avec styles, tableaux, images, sections et table des matières.
- **Relire et réviser** avec les commentaires, les réponses et le suivi des modifications.
- **Personnaliser des courriers** avec le publipostage à partir d’une liste CSV.
- **Ouvrir, annoter et retoucher des PDF**, puis les réenregistrer ou exporter un document au format PDF.

## Compatibilité et fichiers

Plume lit et enregistre les DOCX. Les champs texte, cases à cocher et listes déroulantes pris en charge sont conservés à l’export. Les documents complexes peuvent présenter des écarts de rendu. Pour les DOCM et DOTM, Plume conserve le projet VBA et affiche le code détecté. L’exécution manuelle se fait dans Microsoft Word.

Les fichiers sont traités sur l’appareil. La copie de secours locale est facultative.

## Nouveautés en validation

- Dans **Révision → Compléments → Relecture du document**, sélectionnez un constat pour retrouver le titre, le lien ou l’image à examiner. Le contrôle fonctionne localement.
- Les formulaires DOCX permettent de renseigner les champs de date simples. Les surlignages PDF gardent leur forme vectorielle sur les pages recadrées ou tournées.
- Sous Windows, la commande de lancement des macros propose de créer une copie à ouvrir dans Word. L’utilisateur choisit ensuite la procédure à lancer dans Word.
- Les imports Office contrôlent le volume décompressé. Le bureau limite les écritures aux fichiers autorisés et vérifie la signature des mises à jour. La distribution signée nécessite les clés de l’éditeur.

[Signature des mises à jour](docs/mises-a-jour-signees.md) · [Signature Windows et Android](docs/signature-des-distributions.md)

## Évolutions majeures

| Version | Apport principal |
| --- | --- |
| 1.0 | Édition DOCX, mise en page, modèles et fonctionnement hors ligne. |
| 1.1 | Installateur Windows, commentaires et suivi des modifications, meilleure conservation des objets Word. |
| 1.2 | Ouverture et export dans davantage de formats, dont ODT et PDF. Publipostage CSV, dictée et outils de révision. |
| 1.3 | Éditions mobiles et nouveaux paquets Linux, polices scolaires et export PDF sur mobile. |
| 1.4.0 | Pagination à la ligne, sections et colonnes, édition de graphiques et d’équations, mises à jour intégrées. |
| 1.4.1 | Contrôles de formulaire Word, consultation du code VBA, retouche PDF avec une couche texte reconstruite et téléchargements macOS et Android. |

## Documentation

| Sujet | Ressource |
| --- | --- |
| Compatibilité Word | [Périmètre et protocole de test](docs/compatibilite-word.md) |
| Retouches PDF | [Fonctionnement et limites](docs/pdf-fidelite.md) |
| Développement | [Architecture, lancement et tests](docs/developpement.md) |
| Versions | [Notes de version](docs/notes-de-version) |
| Licence et composants | [Licence et crédits](docs/licence-et-credits.md) |

## Contact

**Pixel’s ASBL**, Rue Alfred Dendal 56, 7300 Boussu, Belgique
[info@asblpixels.be](mailto:info@asblpixels.be) · +32 456 96 03 28 · BCE BE 1013.334.947
