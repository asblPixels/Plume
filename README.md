# Plume

**Plume** est le traitement de texte libre de **Pixel's ASBL** (Boussu). Il ouvre et enregistre les fichiers Word (`.docx`). Il fonctionne dans le navigateur, **hors ligne**, et s'installe comme une application sur Windows, macOS, Linux, Android et iOS.

L'interface reprend l'organisation à laquelle les utilisateurs de traitement de texte sont habitués : menu **Fichier**, ruban à onglets (Accueil, Insertion, Création, Mise en page, Références, Révision, Affichage), règle, barre d'état et raccourcis clavier usuels. Le design, le logo et le code sont propres à Plume.

> Plume est un logiciel indépendant, sans lien avec Microsoft. « Word » et « Office 365 » sont des marques de Microsoft Corporation.

---

## Lancer Plume sous Fedora

Plume est un ensemble de fichiers statiques : ni compilation ni serveur applicatif.

```bash
git clone https://github.com/asblPixels/plume.git
cd plume
python3 -m http.server 8080
```

Ouvrez ensuite **http://localhost:8080** dans Firefox ou Chromium.

> Passez par un petit serveur local (`http://localhost`) et non par un double-clic sur `index.html` : le mode hors ligne et l'installation en application ne fonctionnent pas avec une adresse `file://`.

Pour avoir Chromium sous Fedora (meilleure prise en charge de l'installation et de « Enregistrer » directement dans le fichier) :

```bash
sudo dnf install chromium
```

## Installer Plume comme une application

Plume est une *Progressive Web App*. Une fois installée, elle a son icône (le P turquoise), sa propre fenêtre et fonctionne sans Internet.

| Système | Comment faire |
|---|---|
| **Linux / Windows / macOS** (Chrome, Chromium, Edge) | Icône « Installer » dans la barre d'adresse, ou menu ⋮ → *Installer Plume* |
| **Android** (Chrome) | Menu ⋮ → *Ajouter à l'écran d'accueil* / *Installer l'application* |
| **iPhone / iPad** (Safari) | Bouton Partager → *Sur l'écran d'accueil* |

Sur ordinateur, l'application installée peut être choisie dans « Ouvrir avec… » pour les fichiers `.docx`.

> L'installation exige une adresse **https** (ou `localhost`). Pour l'ouvrir aux bénéficiaires, hébergez le dossier sur un serveur https : GitHub Pages (dépôt public ou offre payante), Netlify, ou le serveur web de l'ASBL.

## Fonctionnalités

**Fichier** : nouveau document, modèles (lettre, CV, rapport, compte rendu de réunion), ouvrir `.docx` / `.html` / `.txt` / `.md`, documents récents, enregistrer en `.docx` (Ctrl+S réécrit le même fichier sous Chrome et Edge), exports PDF, HTML et texte, impression, propriétés du document. Enregistrement automatique sur l'appareil.

**Accueil** : coller, couper, copier, reproduire la mise en forme ; police, taille, agrandir et réduire, casse, gras, italique, souligné, barré, indice, exposant, couleur de police, surlignage, effacer la mise en forme ; puces et numérotation (plusieurs styles, niveaux), retraits, alignements, interligne, marques de paragraphe ¶ ; galerie de styles (Normal, Titre 1 à 3, Titre, Sous-titre, Citation, Code) ; rechercher, remplacer, sélectionner tout.

**Insertion** : page de garde, page vierge, saut de page, tableau (grille ou dialogue), images (fichier, glisser-déposer, coller, redimensionnement à la souris), lien, signet, en-tête, pied de page, numéro de page (« Page X sur Y »), zone de texte, ligne horizontale, date et heure, symboles.

**Création** : police du document, espacement des paragraphes, couleur des titres, page sombre.

**Mise en page** : marges (préréglages et personnalisées), orientation, taille (A4, A5, A3, Lettre, Légal, B5), retraits et espacements chiffrés. La règle permet de faire glisser les marges.

**Références** : table des matières avec numéros de page (convertie en vraie table Word, mise à jour à l'ouverture dans Word), notes de bas de page.

**Révision** : vérification orthographique (celle du navigateur), choix de la langue, statistiques, lecture à voix haute.

**Affichage** : mode Lecture, plein écran, règle, volet de navigation (titres et résultats de recherche), zoom (100 %, une page, largeur de page, Ctrl+molette), thème sombre.

**Tableau** (onglet contextuel) : insérer et supprimer lignes et colonnes, fusionner et fractionner, bordures, trame de fond, ligne d'en-tête répétée, uniformiser les colonnes.

**Recherche de commandes** : `Alt+Q` puis tapez le nom d'une commande.

## Compatibilité `.docx`

Plume lit et écrit le format Office Open XML directement, sans passer par un service en ligne.

Ce qui est conservé à l'ouverture comme à l'enregistrement :

- styles de paragraphe (Normal, titres, titre, sous-titre, citation) et mise en forme directe : police, taille, gras, italique, souligné, barré, couleur, surlignage, exposant et indice, majuscules, espacement des caractères ;
- alignement, retraits, espacement avant et après, interligne, bordures et trame de paragraphe ;
- listes à puces et numérotées sur plusieurs niveaux, y compris la reprise de numérotation ;
- tableaux avec cellules fusionnées horizontalement et verticalement, largeurs de colonnes, trames, alignement vertical, ligne d'en-tête ;
- images en ligne (PNG, JPEG, GIF ; les autres formats sont convertis en PNG) ;
- liens hypertextes et signets ;
- en-tête et pied de page avec champs de numéro de page ;
- notes de bas de page et de fin (le texte) ;
- table des matières (champ TOC) ;
- sauts de page et de section ;
- format, orientation et marges de la page ;
- propriétés du document (titre, auteur).

Limites actuelles (le contenu reste lisible, la présentation peut être simplifiée) :

- les images flottantes deviennent des images en ligne ;
- les graphiques et SmartArt Office sont signalés par un repère `[Graphique]` / `[SmartArt]` ; les images EMF/WMF par `[Image]` ;
- les zones de texte deviennent des encadrés dans le flux du texte ;
- un seul en-tête et un seul pied de page (pas de première page ni de pages paires différentes) ;
- les commentaires, le suivi des modifications (modifications acceptées à l'ouverture), les colonnes multiples, les équations (gardées en texte), les macros et les styles de tableau élaborés ne sont pas encore gérés ;
- l'ancien format `.doc` (Word 97-2003) n'est pas pris en charge : enregistrez d'abord le fichier en `.docx`.

La pagination à l'écran garde chaque paragraphe en entier sur une page. La mise en page finale peut donc différer de quelques lignes de celle de Word. Le fichier `.docx` produit est repaginé par Word à l'ouverture.

## Raccourcis clavier

| Action | Raccourci | Action | Raccourci |
|---|---|---|---|
| Enregistrer | Ctrl+S | Gras / Italique / Souligné | Ctrl+B / I / U |
| Enregistrer sous | F12 | Centrer / Gauche / Droite / Justifier | Ctrl+E / L / R / J |
| Ouvrir | Ctrl+O | Titre 1 / 2 / 3 | Ctrl+Alt+1 / 2 / 3 |
| Nouveau | Ctrl+N | Style Normal | Ctrl+Maj+N |
| Imprimer / PDF | Ctrl+P | Police… | Ctrl+D |
| Annuler / Rétablir | Ctrl+Z / Ctrl+Y | Effacer la mise en forme | Ctrl+Espace |
| Rechercher | Ctrl+F | Agrandir / réduire la police | Ctrl+> / Ctrl+< |
| Remplacer | Ctrl+H | Indice / Exposant | Ctrl+= / Ctrl+Maj+= |
| Lien | Ctrl+K | Note de bas de page | Ctrl+Alt+F |
| Saut de page | Ctrl+Entrée | Recherche de commande | Alt+Q |
| Réduire le ruban | Ctrl+F1 | Plein écran | F11 |

## Structure du projet

```
index.html              page de l'application
manifest.webmanifest    installation (PWA), icônes, ouverture des .docx
sw.js                   fonctionnement hors ligne
css/plume.css           interface et page
js/util.js              outils communs, dialogues, stockage local (IndexedDB)
js/docx-import.js       lecture .docx → HTML
js/docx-export.js       écriture HTML → .docx
js/editor.js            moteur : pages, pagination, historique, commandes
js/ribbon.js            ruban, menus, mini barre
js/backstage.js         menu Fichier, modèles, boîtes de dialogue
js/app.js               fichiers, affichage, raccourcis
js/icons.js             tracés d'icônes
icons/                  logo et icônes d'application
vendor/jszip.min.js     lecture/écriture des archives .docx
```

## Vie privée

Les documents restent sur l'appareil : stockage local du navigateur et fichiers que vous enregistrez vous-même. Plume n'envoie rien sur Internet et ne contient ni compte, ni publicité, ni statistiques d'usage.

## Licences des composants

- [JSZip](https://stuk.github.io/jszip/) : licence MIT
- Tracés d'icônes [Lucide](https://lucide.dev) : licence ISC (restylés pour Plume)

## Contact

Pixel's ASBL : Rue Alfred Dendal 56, 7300 Boussu · info@asblpixels.be · [facebook.com/asblpixels](https://facebook.com/asblpixels)
