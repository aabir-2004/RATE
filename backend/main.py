from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend import models
from backend.database import engine
from backend.api import datasets, analysis, preprocessing, users, projects

import os
import shutil

# Create database tables (if they don't exist)
models.Base.metadata.create_all(bind=engine)

# ── Reset Transient Storage ──
if os.path.exists("uploads"):
    shutil.rmtree("uploads")
os.makedirs("uploads", exist_ok=True)

app = FastAPI(
    title="R.A.T.E. - Factor Assessment System API",
    description="Backend API for predictive model factor evaluation and novelty case generation.",
    version="2.0",
    redirect_slashes=True,
)

# Configure Ultra-Permissive CORS for Vercel/External access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Include routers
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(preprocessing.router)
app.include_router(analysis.router)

@app.get("/", tags=["Health Check"])
def read_root():
    return {"message": "Welcome to R.A.T.E. API. Navigate to /docs for the interactive API documentation."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
