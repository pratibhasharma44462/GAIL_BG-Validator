from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import os
import json
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
    print("   First upload will open a browser for Google login")
    print("   After that, token.json is used automatically\n")
    app.run(debug=True, port=5000)