from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend import models, schemas
from backend.database import get_db

router = APIRouter(prefix="/users", tags=["Users"])

@router.post("/", response_model=schemas.UserResponse)
def create_user(request: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == request.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
        
    user = models.User(
        name=request.name,
        email=request.email,
        role=request.role,
        password_hash=f"hashed_{request.password}" # Mock hash for demonstration
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
    
@router.get("/", response_model=List[schemas.UserResponse])
def read_users(db: Session = Depends(get_db)):
    return db.query(models.User).all()
