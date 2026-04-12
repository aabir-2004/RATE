from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend import models, schemas
from backend.database import get_db

router = APIRouter(prefix="/projects", tags=["Projects"])

@router.post("/", response_model=schemas.ProjectResponse)
def create_project(request: schemas.ProjectCreate, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.user_id == request.owner_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Owner not found")
        
    project = models.Project(
        title=request.title,
        description=request.description,
        owner_id=request.owner_id
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project

@router.get("/", response_model=List[schemas.ProjectResponse])
def read_projects(db: Session = Depends(get_db)):
    return db.query(models.Project).all()
