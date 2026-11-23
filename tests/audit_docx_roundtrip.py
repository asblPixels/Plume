#!/usr/bin/env python3
"""Audit structurel et conservateur de fichiers DOCX avant/après Plume.

Usage :
    python3 tests/audit_docx_roundtrip.py original.docx sortie-plume.docx
    python3 tests/audit_docx_roundtrip.py original.docx sortie-plume.docx --json

Codes retour : 0 = aucune erreur structurelle, 1 = perte/erreur, 2 = entrée illisible.
Les avertissements ne prouvent pas une incompatibilité : des modifications
volontaires sont possibles. Cet audit ne remplace pas l'ouverture dans Word.
Dépendances : bibliothèque standard Python uniquement.
"""
import argparse
import hashlib
import json
import posixpath
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
REL_SUFFIX = ".rels"
PROTECTED_PREFIXES = (
    "word/embeddings/", "word/activeX/", "word/vba", "customXml/",
)
PROTECTED_EXTENSIONS = (".bin", ".emf", ".wmf")
# Un graphique peut légitimement changer si l'utilisateur l'a modifié.
WATCH_PREFIXES = (
    "word/charts/", "word/diagrams/", "word/media/", "word/fonts/",
    "word/embeddings/", "word/activeX/", "customXml/",
)


def read_package(path):
    """Retourne les octets et les anomalies d'un paquet OOXML."""
    result = {"errors": [], "parts": {}}
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            result["errors"].append("Entrées ZIP dupliquées")
        for name in names:
            if name.endswith("/"):
                continue
            if name.startswith("/") or ".." in name.split("/"):
                result["errors"].append(f"Chemin ZIP dangereux : {name}")
                continue
            raw = archive.read(name)
            result["parts"][name] = raw
            if name.endswith((".xml", ".rels")) or name == "[Content_Types].xml":
                try:
                    ET.fromstring(raw)
                except ET.ParseError as exc:
                    result["errors"].append(f"XML invalide {name}: {exc}")
    for required in ("[Content_Types].xml", "_rels/.rels", "word/document.xml"):
        if required not in result["parts"]:
            result["errors"].append(f"Partie requise absente : {required}")
    result["errors"].extend(broken_relationships(result["parts"]))
    result["errors"].extend(content_type_errors(result["parts"]))
    return result


def owner_directory(rels_path):
    """Dossier de la partie propriétaire d'un fichier de relations OOXML."""
    if rels_path == "_rels/.rels":
        return ""
    directory, basename = posixpath.split(rels_path)
    if not directory.endswith("/_rels") or not basename.endswith(REL_SUFFIX):
        raise ValueError(rels_path)
    return directory[:-6]  # supprime '/_rels'


def broken_relationships(parts):
    problems = []
    for rels_path, raw in parts.items():
        if not rels_path.endswith(".rels"):
            continue
        try:
            root = ET.fromstring(raw)
            base = owner_directory(rels_path)
        except (ET.ParseError, ValueError):
            continue
        seen = set()
        for rel in root.findall(f"{PKG_REL}Relationship"):
            rid = rel.get("Id")
            if rid in seen:
                problems.append(f"Identifiant de relation dupliqué : {rels_path} #{rid}")
            seen.add(rid)
            if rel.get("TargetMode", "").lower() == "external":
                continue
            target = rel.get("Target")
            if not target:
                problems.append(f"Relation sans Target : {rels_path} #{rid}")
                continue
            # URI fragment et paramètres ne désignent pas une partie du paquet.
            target = target.split("#", 1)[0].split("?", 1)[0]
            if not target:
                continue
            if target.startswith("/"):
                resolved = posixpath.normpath(target.lstrip("/"))
            else:
                resolved = posixpath.normpath(posixpath.join(base, target))
            if resolved.startswith("../") or resolved not in parts:
                problems.append(f"Relation cassée : {rels_path} #{rid} -> {resolved}")
    return problems


def content_type_errors(parts):
    """Vérifie que chaque partie a un type MIME déclaré dans OPC."""
    raw = parts.get("[Content_Types].xml")
    if not raw:
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []  # déjà signalée par read_package
    namespace = "{http://schemas.openxmlformats.org/package/2006/content-types}"
    defaults = {e.get("Extension", "").lower() for e in root.findall(f"{namespace}Default")}
    overrides = {e.get("PartName", "").lstrip("/") for e in root.findall(f"{namespace}Override")}
    errors = []
    for name in parts:
        if name == "[Content_Types].xml":
            continue
        extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if name not in overrides and extension not in defaults:
            errors.append(f"Type de contenu absent : {name}")
    return errors


def semantic_inventory(parts):
    """Indicateurs OOXML : pour orienter la comparaison, pas juger les éditions."""
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    tags = {
        "paragraphes": "p", "tableaux": "tbl", "sections": "sectPr",
        "images_et_formes": "drawing", "commentaires": "commentRangeStart",
        "insertions_suivies": "ins", "suppressions_suivies": "del",
        "hyperliens": "hyperlink", "notes": "footnoteReference",
        "champs": "fldChar",
    }
    found = {key: 0 for key in tags}
    xml = parts.get("word/document.xml")
    if not xml:
        return found
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return found
    for key, name in tags.items():
        found[key] = sum(1 for _ in root.iter(f"{ns}{name}"))
    return found


def is_protected(name):
    return name.startswith(PROTECTED_PREFIXES) or name.endswith(PROTECTED_EXTENSIONS)


def audit(original, output):
    before, after = read_package(original), read_package(output)
    failures = [f"Original : {x}" for x in before["errors"]]
    failures += [f"Export : {x}" for x in after["errors"]]
    before_parts, after_parts = before["parts"], after["parts"]
    missing = sorted(set(before_parts) - set(after_parts))
    warnings = []
    for name in missing:
        if is_protected(name):
            failures.append(f"Partie opaque/protégée supprimée : {name}")
        elif name.startswith(WATCH_PREFIXES):
            warnings.append(f"Élément complexe absent (vérifier si volontaire) : {name}")
        else:
            warnings.append(f"Partie retirée (évaluer si volontaire) : {name}")
    for name in sorted(set(before_parts) & set(after_parts)):
        if before_parts[name] != after_parts[name] and is_protected(name):
            warnings.append(f"Contenu opaque/protégé changé : {name}")
    semantic_before = semantic_inventory(before_parts)
    semantic_after = semantic_inventory(after_parts)
    for key, count in semantic_before.items():
        if semantic_after[key] < count:
            warnings.append(f"Éléments {key} : {count} -> {semantic_after[key]} (vérifier si édition volontaire)")
    return {
        "original": str(original),
        "export": str(output),
        "parts_before": len(before_parts),
        "parts_after": len(after_parts),
        "structure_before": semantic_before,
        "structure_after": semantic_after,
        "sha256_export": hashlib.sha256(Path(output).read_bytes()).hexdigest(),
        "errors": failures,
        "warnings": warnings,
        "note": "Audit structurel uniquement : valider rendu et fidélité dans Microsoft Word.",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("export", type=Path)
    parser.add_argument("--json", action="store_true", help="Rapport JSON")
    args = parser.parse_args(argv)
    try:
        result = audit(args.original, args.export)
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError) as exc:
        print(f"Fichier illisible : {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"DOCX : {result['parts_before']} -> {result['parts_after']} parties")
        for error in result["errors"]:
            print(f"ERREUR : {error}")
        for warning in result["warnings"]:
            print(f"ATTENTION : {warning}")
        if not result["errors"]:
            print("Aucune perte structurelle critique détectée (fidélité non garantie).")
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
