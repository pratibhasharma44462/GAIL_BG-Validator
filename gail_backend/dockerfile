# Deploy this repo to Render as a "Web Service" using this Dockerfile.
FROM python:3.12-slim

# Install Tesseract OCR 
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120 app:app