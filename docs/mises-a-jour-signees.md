# Mises à jour du contenu de Plume Desktop

Le client conserve la version intégrée lorsque la clé publique de distribution est absente. Les anciens téléchargements non signés sont ignorés. Une version candidate est activée au prochain démarrage après vérification du manifeste Ed25519 et des empreintes de tous les fichiers. Si la version active devient illisible, Plume cherche une version signée antérieure puis revient à la version intégrée.

## Préparation par le responsable de publication

1. Créer et sauvegarder une paire Ed25519 dans le dispositif de signature de l’association. Conserver la clé privée hors du dépôt et des paquets.
2. Exécuter `node outils/sign-update.js pin chemin/cle-publique.pem` puis vérifier et versionner `desktop/update-key.json`. Construire et distribuer le client avec cette clé.
3. Pour chaque version web, incrémenter la version et exécuter `node outils/version.js`, puis `node outils/sign-update.js sign chemin-protege/cle-privee.pem`. La commande vérifie la correspondance avec la clé intégrée.
4. Publier les fichiers web, `version.json` et le fichier binaire `version.json.sig` ensemble sur GitHub Pages. Vérifier sur un poste pilote la détection, le redémarrage et la version chargée.

Une rotation de la clé nécessite de distribuer un nouveau client bureau. La signature du manifeste couvre le contenu web. Les signatures propres aux installateurs Windows et Android suivent leurs circuits de publication respectifs.
