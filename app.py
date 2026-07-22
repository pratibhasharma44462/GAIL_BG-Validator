from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import os
import json
import base64
import sqlite3
from datetime import datetime

try:
    from bg_validator import validate_pdf
    BG_VALIDATOR_AVAILABLE = True
    print("✅ BG Validator loaded")
except ImportError as e:
    BG_VALIDATOR_AVAILABLE = False
    print(f"⚠️  BG Validator not available: {e}")

app = Flask(__name__)
CORS(app)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gail_portal.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS completed_documents (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            filename     TEXT NOT NULL,
            verdict      TEXT,
            bg_data      TEXT,   -- JSON blob of the full validation result
            comments     TEXT,   -- JSON blob of {clauseId: commentText}
            completed_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


init_db()

@app.route("/api/completed", methods=["GET"])
def get_completed():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM completed_documents ORDER BY id DESC"
    ).fetchall()
    conn.close()

    docs = []
    for r in rows:
        docs.append({
            "id": r["id"],
            "filename": r["filename"],
            "verdict": r["verdict"],
            "bgData": json.loads(r["bg_data"]) if r["bg_data"] else None,
            "comments": json.loads(r["comments"]) if r["comments"] else {},
            "completedAt": r["completed_at"],
        })
    return jsonify(docs)


@app.route("/api/completed", methods=["POST"])
def add_completed():
    data = request.get_json(force=True, silent=True) or {}

    filename = data.get("filename")
    if not filename:
        return jsonify({"error": "filename is required"}), 400

    bg_data = data.get("bgData")
    comments = data.get("comments", {})
    completed_at = data.get("completedAt") or datetime.now().strftime("%d/%m/%Y, %H:%M:%S")
    verdict = bg_data.get("verdict") if isinstance(bg_data, dict) else None

    conn = get_db()
    cur = conn.execute(
        """INSERT INTO completed_documents
           (filename, verdict, bg_data, comments, completed_at)
           VALUES (?, ?, ?, ?, ?)""",
        (
            filename,
            verdict,
            json.dumps(bg_data) if bg_data is not None else None,
            json.dumps(comments),
            completed_at,
        ),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    return jsonify({
        "id": new_id,
        "filename": filename,
        "verdict": verdict,
        "bgData": bg_data,
        "comments": comments,
        "completedAt": completed_at,
    }), 201


@app.route("/api/completed/<int:doc_id>", methods=["DELETE"])
def delete_completed(doc_id):
    conn = get_db()
    conn.execute("DELETE FROM completed_documents WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()
    return jsonify({"deleted": doc_id})

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/validate-bg", methods=["POST"])
def validate_bg():
    if not BG_VALIDATOR_AVAILABLE:
        return jsonify({
            "error": "BG Validator packages not installed. Run: pip install python-docx rapidfuzz python-dateutil"
        }), 500

    if "file" not in request.files:
        return jsonify({"error": "No file received"}), 400

    file = request.files["file"]
    if not file.filename.lower().endswith((".pdf", ".docx")):
        return jsonify({"error": "Only PDF or Word (.docx) files are supported"}), 400

    expected_amount = request.form.get("expected_amount") or None
    expected_po     = request.form.get("expected_po") or None

    try:
        file_bytes = file.read()
        result     = validate_pdf(
            file_bytes,
            filename=file.filename,
            expected_amount=expected_amount,
            expected_po=expected_po
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"Validation failed: {str(e)}"}), 500


# -------------------------------------------------------
# ROUTE: /api/validate-bg
# JSON-based API — accepts a file as base64 text in the request body
# instead of multipart/form-data. Useful for calling this validator
# from external tools (e.g. an Automation Anywhere bot, another
# service, Postman, curl) rather than from this website's own UI.
#
# Expected request body (JSON):
# {
#   "filename": "guarantee.pdf",
#   "file_base64": "JVBERi0xLjQKJ...",   <- base64-encoded file content
#   "expected_amount": "500000",          <- optional
#   "expected_po": "GAIL/C/123"           <- optional
# }
# -------------------------------------------------------
@app.route("/api/validate-bg", methods=["POST"])
def api_validate_bg():
    print("[/api/validate-bg] Request received", flush=True)

    if not BG_VALIDATOR_AVAILABLE:
        return jsonify({"error": "BG Validator not installed."}), 500

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    filename = data.get("filename")
    file_b64 = data.get("file_base64")

    if not filename:
        return jsonify({"error": "'filename' is required"}), 400
    if not file_b64:
        return jsonify({"error": "'file_base64' is required"}), 400
    if not filename.lower().endswith((".pdf", ".docx")):
        return jsonify({"error": "Only .pdf or .docx filenames are supported"}), 400

    # Some callers prefix base64 with "data:application/pdf;base64,....".
    # Strip that prefix if present, so we only decode the actual base64 part.
    if "," in file_b64 and file_b64.strip().startswith("data:"):
        file_b64 = file_b64.split(",", 1)[1]

    try:
        file_bytes = base64.b64decode(file_b64)
    except Exception as e:
        return jsonify({"error": f"Invalid base64 in 'file_base64': {str(e)}"}), 400

    print(f"[/api/validate-bg] File: {filename}, {len(file_bytes)} bytes decoded", flush=True)

    expected_amount = data.get("expected_amount") or None
    expected_po     = data.get("expected_po") or None

    try:
        result = validate_pdf(
            file_bytes,
            filename=filename,
            expected_amount=expected_amount,
            expected_po=expected_po
        )
        print(f"[/api/validate-bg] Done: verdict={result['verdict']}", flush=True)
        return jsonify(result)
    except Exception as e:
        import traceback
        print(f"[/api/validate-bg] EXCEPTION: {e}", flush=True)
        traceback.print_exc()
        return jsonify({"error": f"Validation failed: {str(e)}"}), 500


@app.route("/health", methods=["GET"])
def health_check():
    try:
        ready, msg = drive_ready()
    except NameError:
        ready, msg = False, "drive_ready() not defined in this file"
    return jsonify({
        "status":        "Server is running!",
        "bg_validator":  BG_VALIDATOR_AVAILABLE,
        "drive_ready":   ready,
        "drive_message": msg,
        "db_path":       DB_PATH,
    })


if __name__ == "__main__":
    print("\n🚀 GAIL Backend starting at http://localhost:5000")
    print(f"   Completed-documents DB: {DB_PATH}")
    app.run(debug=True, port=5000)
