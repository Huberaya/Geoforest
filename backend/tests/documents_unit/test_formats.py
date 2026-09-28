import io

import pytest
from app.documents.format_worker import inspect
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject


def pdf(action=None, encrypted=False):
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    if action:
        # An unreferenced indirect object must also be examined.
        w._add_object(DictionaryObject({NameObject("/S"): NameObject(action)}))
    if encrypted:
        w.encrypt("fictional-password")
    f = io.BytesIO()
    w.write(f)
    return f.getvalue()


def test_passive_pdf():
    assert inspect(pdf()) == {"mime": "application/pdf", "pages": 1}


@pytest.mark.parametrize(
    "action",
    [
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
    ],
)
def test_active_unreferenced_pdf_values_rejected(action):
    with pytest.raises(ValueError):
        inspect(pdf(action))


def test_encrypted_pdf_rejected():
    with pytest.raises(ValueError):
        inspect(pdf(encrypted=True))


def test_pdf_active_key():
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    w._root_object[NameObject("/OpenAction")] = TextStringObject("fictitious")
    f = io.BytesIO()
    w.write(f)
    with pytest.raises(ValueError):
        inspect(f.getvalue())


@pytest.mark.parametrize("kind,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg")])
def test_image_valid_and_trailing_rejected(kind, mime):
    f = io.BytesIO()
    Image.new("RGB", (5, 5), "white").save(f, format=kind)
    assert inspect(f.getvalue())["mime"] == mime
    with pytest.raises(ValueError):
        inspect(f.getvalue() + b"<html>fictional</html>")


@pytest.mark.parametrize("kind", ["GIF", "BMP", "TIFF"])
def test_other_formats_rejected(kind):
    f = io.BytesIO()
    Image.new("RGB", (5, 5), "white").save(f, format=kind)
    with pytest.raises(ValueError):
        inspect(f.getvalue())


def test_pdf_page_budget():
    w = PdfWriter()
    for _ in range(101):
        w.add_blank_page(width=72, height=72)
    f = io.BytesIO()
    w.write(f)
    with pytest.raises(ValueError):
        inspect(f.getvalue())


def test_image_dimension_budget():
    f = io.BytesIO()
    Image.new("RGB", (12001, 1), "white").save(f, format="PNG")
    with pytest.raises(ValueError):
        inspect(f.getvalue())
