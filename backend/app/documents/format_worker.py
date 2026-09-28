"""Decode only bounded, non-active PDF/JPEG/PNG. No rendering or OCR."""

import io
import json
import resource
import sys
import warnings


def inspect(data):
    if data.startswith(b"%PDF-"):
        from pypdf import PdfReader
        from pypdf.generic import IndirectObject

        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError("ENCRYPTED_PDF")
        if not 1 <= len(reader.pages) <= 100:
            raise ValueError("PDF_PAGE_LIMIT")
        if sum(len(v) for v in reader.xref.values()) + len(reader.xref_objStm) > 5000:
            raise ValueError("PDF_OBJECT_LIMIT")
        banned = {
            "/JS",
            "/JavaScript",
            "/OpenAction",
            "/AA",
            "/EmbeddedFiles",
            "/RichMedia",
            "/XFA",
            "/Launch",
            "/URI",
            "/AcroForm",
        }
        forbidden_values = {
            "/JavaScript",
            "/Launch",
            "/GoToR",
            "/GoToE",
            "/SubmitForm",
            "/ImportData",
            "/Rendition",
            "/Movie",
            "/Sound",
            "/3D",
            "/EmbeddedFile",
            "/Filespec",
            "/FileAttachment",
        }
        seen = set()

        def walk(obj, depth=0):
            if depth > 24:
                raise ValueError("PDF_DEPTH_LIMIT")
            if isinstance(obj, IndirectObject):
                key = (obj.idnum, obj.generation)
                if key in seen:
                    return
                seen.add(key)
                obj = obj.get_object()
            if isinstance(obj, str) and obj in forbidden_values:
                raise ValueError("ACTIVE_PDF")
            if isinstance(obj, dict):
                if banned.intersection(obj.keys()):
                    raise ValueError("ACTIVE_PDF")
                for key, value in obj.items():
                    if key not in ("/Parent", "/P"):
                        walk(value, depth + 1)
            elif isinstance(obj, (list, tuple)):
                for value in obj:
                    walk(value, depth + 1)

        walk(reader.trailer)
        for generation, objects in reader.xref.items():
            for number in objects:
                if number:
                    walk(IndirectObject(number, generation, reader))
        for number in reader.xref_objStm:
            walk(IndirectObject(number, 0, reader))
        return {"mime": "application/pdf", "pages": len(reader.pages)}
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = 20_000_000
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    with Image.open(io.BytesIO(data)) as image:
        kind = image.format
        if kind not in ("PNG", "JPEG") or getattr(image, "n_frames", 1) != 1:
            raise ValueError("IMAGE_FORMAT")
        if image.width * image.height > 20_000_000 or max(image.size) > 12000:
            raise ValueError("IMAGE_DIMENSIONS")
        dimensions = list(image.size)
        image.verify()
    if kind == "PNG" and not data.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82"):
        raise ValueError("TRAILING_DATA")
    if kind == "JPEG" and not data.endswith(b"\xff\xd9"):
        raise ValueError("TRAILING_DATA")
    with Image.open(io.BytesIO(data)) as image:
        image.load()
    return {
        "mime": "image/png" if kind == "PNG" else "image/jpeg",
        "dimensions": dimensions,
    }


def main():
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024**2,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4096, 4096))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    data = sys.stdin.buffer.read(20 * 1024**2 + 1)
    if not 1 <= len(data) <= 20 * 1024**2:
        raise ValueError("FILE_SIZE")
    print(json.dumps(inspect(data)))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(2)
