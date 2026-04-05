from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List
import pandas as pd
import io

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/datasets", tags=["Datasets"])

@router.post("/", response_model=schemas.DatasetResponse)
async def upload_dataset(
    project_id: int = Form(...),
    domain: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    if not file.filename.endswith(('.csv', '.xlsx')):
        raise HTTPException(status_code=400, detail="Only CSV and Excel files are supported.")
        
    contents = await file.read()
    try:
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")
        
    import os
    
    # Save file metadata to DB first to get an ID
    db_dataset = models.Dataset(
        project_id=project_id,
        file_name=file.filename,
        domain=domain,
        rows=len(df),
        columns=len(df.columns)
    )
    db.add(db_dataset)
    db.commit()
    db.refresh(db_dataset)
    
    # Save the dataframe securely to disk
    os.makedirs("uploads", exist_ok=True)
    file_path = f"uploads/{db_dataset.dataset_id}_dataset.csv"
    df.to_csv(file_path, index=False)
    
    return db_dataset

@router.get("/project/{project_id}", response_model=List[schemas.DatasetResponse])
def get_datasets_by_project(project_id: int, db: Session = Depends(get_db)):
    datasets = db.query(models.Dataset).filter(models.Dataset.project_id == project_id).all()
    return datasets
