"""Locate fail/warn clause matches on specific PDF pages so the frontend
can draw red/orange highlight boxes over the exact text.

Limitation: this only works for pages with a real embedded text layer
(digital / NESL PDFs). Pages that had to be OCR'd (scanned physical BGs)
have no searchable text layer in the PDF itself, so those clauses are
left un-highlighted (highlight = None) rather than guessed at.
"""
from rapidfuzz import fuzz
from .clauses import CLAUSES, _norm

_TEMPLATES = {cid: _norm(template) for cid, _title, template in CLAUSES}

MIN_LOCATE_SCORE = 55       
MAX_SEARCH_CHARS = 220      


def _best_page_for_clause(template_norm, pages_raw, ocr_flags):
    best = None
    for i, ptext in enumerate(pages_raw):
        if ocr_flags and i < len(ocr_flags) and ocr_flags[i]:
            continue  
        if not ptext or not ptext.strip():
            continue
        lower = ptext.lower()
        align = fuzz.partial_ratio_alignment(template_norm, lower)
        if align is None:
            continue
        start, end = align.dest_start, align.dest_end
        if end <= start:
            continue
        end = min(end, start + MAX_SEARCH_CHARS)
        score = fuzz.partial_ratio(template_norm, lower[start:end])
        if best is None or score > best[0]:
            best = (score, i, start, end)
    return best


def locate_highlights(doc, pages_raw, ocr_flags, clauses):
    """Mutates each clause dict in `clauses`, adding a `highlight` key.

    doc        : open fitz.Document (must still be open — do not close
                 before calling this)
    pages_raw  : list of raw per-page text, in original order (same as
                 returned by extract())
    ocr_flags  : list of bool, True where that page's text came from OCR
    clauses    : list of clause dicts as produced by compare_clauses()

    highlight = {"page": <0-indexed>, "rects": [[x0,y0,x1,y1], ...]}
                or None if it couldn't be located.
    """
    for clause in clauses:
        clause["highlight"] = None
        if clause.get("status") == "pass":
            continue  

        template_norm = _TEMPLATES.get(clause["id"])
        if not template_norm:
            continue

        best = _best_page_for_clause(template_norm, pages_raw, ocr_flags)
        if not best or best[0] < MIN_LOCATE_SCORE:
            continue

        _, page_idx, start, end = best
        raw_page_text = pages_raw[page_idx]
        snippet = raw_page_text[start:end].strip()
        if len(snippet) < 15:
            continue

        page = doc[page_idx]
        rects = page.search_for(snippet)
        if not rects:
            half = snippet[: len(snippet) // 2].strip()
            if len(half) >= 15:
                rects = page.search_for(half)

        if rects:
            clause["highlight"] = {
                "page": page_idx,
                "rects": [[r.x0, r.y0, r.x1, r.y1] for r in rects],
            }

    return clauses