"""Tests unitaires autonomes de l'audit DOCX (sans Word ni Playwright)."""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "audit_docx_roundtrip", Path(__file__).with_name("audit_docx_roundtrip.py")
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

TYPES = b'''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="bin" ContentType="application/octet-stream"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
 </Types>'''
ROOT_RELS = b'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''
DOC = b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>'
DOC_RELS = b'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId2" Type="https://example.invalid/image" Target="media/image1.png"/>
 <Relationship Id="rId3" Type="https://example.invalid/link" Target="https://example.org/" TargetMode="External"/>
</Relationships>'''


def package(path, extra=None, rels=DOC_RELS):
    entries = {
        "[Content_Types].xml": TYPES,
        "_rels/.rels": ROOT_RELS,
        "word/document.xml": DOC,
        "word/_rels/document.xml.rels": rels,
        "word/media/image1.png": b"image",
    }
    if extra:
        entries.update(extra)
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in entries.items():
            if data is not None:
                archive.writestr(name, data)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.original = Path(self.temp.name) / "source.docx"
        self.export = Path(self.temp.name) / "sortie.docx"

    def test_identical_roundtrip(self):
        package(self.original)
        package(self.export)
        self.assertFalse(module.audit(self.original, self.export)["errors"])

    def test_preserved_macro_passes(self):
        package(self.original, {"word/vbaProject.bin": b"vba"})
        package(self.export, {"word/vbaProject.bin": b"vba"})
        self.assertFalse(module.audit(self.original, self.export)["errors"])

    def test_removed_macro_is_failure(self):
        package(self.original, {"word/vbaProject.bin": b"vba"})
        package(self.export)
        self.assertTrue(any("vbaProject.bin" in s for s in module.audit(self.original, self.export)["errors"]))

    def test_changed_opaque_part_is_warning(self):
        package(self.original, {"word/embeddings/ole1.bin": b"a"})
        package(self.export, {"word/embeddings/ole1.bin": b"b"})
        self.assertFalse(module.audit(self.original, self.export)["errors"])
        self.assertTrue(module.audit(self.original, self.export)["warnings"])

    def test_missing_image_reference_is_failure(self):
        package(self.original)
        package(self.export, {"word/media/image1.png": None})
        self.assertTrue(any("Relation cassée" in s for s in module.audit(self.original, self.export)["errors"]))

    def test_invalid_xml_is_failure(self):
        package(self.original)
        package(self.export, {"word/document.xml": b"<broken"})
        self.assertTrue(any("XML invalide" in s for s in module.audit(self.original, self.export)["errors"]))

    def test_missing_content_type_is_failure(self):
        package(self.original)
        package(self.export, {"word/media/illustration.xyz": b"image"})
        self.assertTrue(any("Type de contenu absent" in e for e in module.audit(self.original, self.export)["errors"]))

    def test_semantic_inventory_detects_sections(self):
        package(self.original)
        package(self.export, {"word/document.xml": DOC.replace(b"</w:body>", b"<w:sectPr/></w:body>")})
        report = module.audit(self.original, self.export)
        self.assertEqual(report["structure_before"]["sections"], 0)
        self.assertEqual(report["structure_after"]["sections"], 1)

    def test_external_relation_not_resolved_as_part(self):
        package(self.original)
        package(self.export)
        self.assertFalse(module.read_package(self.export)["errors"])


if __name__ == "__main__":
    unittest.main()
