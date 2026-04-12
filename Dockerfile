FROM python:3.11-slim

# Set up a new user with UID 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

# Install system dependencies (must be root)
USER root
RUN apt-get update && apt-get install -y build-essential curl && rm -rf /var/lib/apt/lists/*
USER user

# Copy and install requirements
COPY --chown=user backend/requirements.txt ./backend/
RUN pip install --no-cache-dir --default-timeout=1000 -r backend/requirements.txt

# Copy source and ensure permissions
COPY --chown=user . .

# Create uploads dir and ensure it is writable
RUN mkdir -p uploads && chmod 777 uploads

# HuggingFace Spaces REQUIRES port 7860
EXPOSE 7860

# Run on HF's required port
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
