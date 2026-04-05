from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import engine
from .api import datasets, analysis, preprocessing, users, projects

# Create database tables (if they don't exist)
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="R.A.T.E. - Factor Assessment System API",
    description="Backend API for predictive model factor evaluation and novelty case generation.",
    version="2.0",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
