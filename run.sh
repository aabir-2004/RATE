#!/bin/bash

echo "Starting R.A.T.E. Backend Server..."

# Check if venv exists, if not create and install
if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Creating 'venv'..."
    python3 -m venv venv
    
    echo "Activating virtual environment..."
    source venv/bin/activate
else
    echo "Activating virtual environment..."
    source venv/bin/activate
fi

echo "Syncing dependencies (with low-network tolerance)..."
pip install --default-timeout=1000 --retries=10 -r backend/requirements.txt

# Clear any previously running instances on port 8000 to prevent 'Address in use' crashes
echo "Clearing port 8000 occupancy..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true

# Run the FastAPI server via uvicorn
echo "Launching FastAPI..."
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
