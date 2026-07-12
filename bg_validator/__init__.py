# 

"""GAIL Bank Guarantee Validator — extraction + F-4 compliance engine."""
from .clauses import compare_clauses
from .extract import extract, normalise
from .rules import extract_fields, run_checks
from .highlight import locate_highlights

ORDER = {"fail": 0, "warn": 1, "pass": 2, "info": 3}


def validate_pdf(pdf_bytes, filename="", expected_amount=None, expected_po=None):
    ext = extract(pdf_bytes)
    norm = normalise(ext["text"])
    fields = extract_fields(norm)
    checks = run_checks(fields, norm, ext["kind"],
                        expected_amount=expected_amount,
                        expected_po=expected_po)
    clauses = compare_clauses(ext["text"])


    locate_highlights(ext["doc"], ext["pages"], ext["ocr_flags"], clauses)
    ext["doc"].close()

    statuses = [c["status"] for c in checks] + [c["status"] for c in clauses]
    if "fail" in statuses:
        verdict = "DISCREPANT"
    elif "warn" in statuses:
        verdict = "NEEDS REVIEW"
    else:
        verdict = "COMPLIANT"

    checks.sort(key=lambda c: ORDER.get(c["status"], 9))
    return {
        "filename": filename,
        "kind": ext["kind"],
        "page_count": ext["page_count"],
        "used_ocr": ext["used_ocr"],
        "ocr_pages": ext["ocr_pages"],
        "fields": fields,
        "checks": checks,
        "clauses": clauses,    
        "verdict": verdict,
        "counts": {
            "fail": statuses.count("fail"),
            "warn": statuses.count("warn"),
            "pass": statuses.count("pass"),
        },
    }