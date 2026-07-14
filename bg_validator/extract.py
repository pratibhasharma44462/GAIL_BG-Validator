import io
import re
import fitz  # PyMuPDF
import pytesseract
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

# import platform
# if platform.system() == "Windows":
#     pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

MIN_TEXT_CHARS = 40
OCR_DPI = 150        
OCR_WORKERS = 1    

def _ocr_page(page):
    """Returns (text, used_ocr) for a single page. Runs in a worker thread."""
    text = page.get_text("text")
    if len(text.strip()) >= MIN_TEXT_CHARS:
        return text, False  
    pix = page.get_pixmap(dpi=OCR_DPI)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    ocr_text = pytesseract.image_to_string(img, config="--psm 4 --oem 1")
    return ocr_text, True


def extract(pdf_bytes):
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_list = list(doc)

    with ThreadPoolExecutor(max_workers=OCR_WORKERS) as pool:
        results = list(pool.map(_ocr_page, page_list))

    pages     = [r[0] for r in results]
    ocr_flags = [r[1] for r in results]
    ocr_pages = sum(ocr_flags)

    full = "\n".join(pages)
    kind = _detect_kind(full, ocr_pages, len(pages))

    return {
        "doc": doc,              
        "text": full,
        "pages": pages,
        "ocr_flags": ocr_flags,
        "page_count": len(pages),
        "ocr_pages": ocr_pages,
        "used_ocr": ocr_pages > 0,
        "kind": kind,
    }


def _detect_kind(text, ocr_pages, page_count):
    t = text.lower()
    nesl_signals = sum(
        1 for s in ("nesl", "e-stamp", "sfms", "ifn 760", "digitally signed")
        if s in t
    )
    if nesl_signals >= 2 and ocr_pages == 0:
        return "nesl"
    if ocr_pages == page_count:
        return "physical"
    if ocr_pages > 0:
        return "physical"
    return "nesl" if nesl_signals else "digital"


def normalise(text):
    t = re.sub(r"\s+", " ", text)
    return t.strip()
