FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y build-essential curl && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir --default-timeout=1000 -r backend/requirements.txt

# Persistent upload storage
RUN mkdir -p uploads

# Copy backend source
COPY backend ./backend

# HuggingFace Spaces REQUIRES port 7860
EXPOSE 7860

# Run on HF's required port
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
