from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List
import pandas as pd
import io

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/datasets", tags=["Datasets"])

@router.post("/upload_chunk")
def upload_chunk(
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    file: UploadFile = File(...)
):
    import os
    import shutil
    
    os.makedirs(f"uploads/temp_{upload_id}", exist_ok=True)
    chunk_path = f"uploads/temp_{upload_id}/chunk_{chunk_index}"
    
    with open(chunk_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"status": "success"}

@router.post("/finalize_upload", response_model=schemas.DatasetResponse)
def finalize_upload(
    upload_id: str = Form(...),
    file_name: str = Form(...),
    domain: str = Form(...),
    project_id: int = Form(...),
    total_chunks: int = Form(...),
    db: Session = Depends(get_db)
):
    if not file_name.endswith(('.csv', '.xlsx')):
        raise HTTPException(status_code=400, detail="Only CSV and Excel files are supported.")
        
    import os
    import shutil
    
    # Reassemble the file
    final_temp_path = f"uploads/assembled_{upload_id}_{file_name}"
    with open(final_temp_path, "wb") as final_file:
        for i in range(total_chunks):
            chunk_path = f"uploads/temp_{upload_id}/chunk_{i}"
            if not os.path.exists(chunk_path):
                raise HTTPException(status_code=400, detail=f"Missing chunk {i}")
            with open(chunk_path, "rb") as chunk_file:
                shutil.copyfileobj(chunk_file, final_file)
                
    try:
        # Use batched processing to avoid memory explosion
        if file_name.endswith('.csv'):
            chunk_iter = pd.read_csv(final_temp_path, chunksize=50000)
            rows = 0
            columns_list = []
            for i, chunk_df in enumerate(chunk_iter):
                if i == 0:
                    columns_list = chunk_df.columns.tolist()
                rows += len(chunk_df)
        else:
            df = pd.read_excel(final_temp_path)
            rows = len(df)
            columns_list = df.columns.tolist()
    except Exception as e:
        if os.path.exists(final_temp_path):
            os.remove(final_temp_path)
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")
        
    db_dataset = models.Dataset(
        project_id=project_id,
        file_name=file_name,
        domain=domain,
        rows=rows,
        columns=len(columns_list)
    )
    db.add(db_dataset)
    db.commit()
    db.refresh(db_dataset)
    
    file_path = f"uploads/{db_dataset.dataset_id}_dataset.csv"
    
    if file_name.endswith('.csv'):
        os.rename(final_temp_path, file_path)
    else:
        df.to_csv(file_path, index=False)
        os.remove(final_temp_path)
        
    # Cleanup temp directory
    shutil.rmtree(f"uploads/temp_{upload_id}", ignore_errors=True)
    
    response_data = schemas.DatasetResponse.model_validate(db_dataset).model_dump()
    response_data["columns_list"] = columns_list
    return response_data

@router.get("/project/{project_id}", response_model=List[schemas.DatasetResponse])
def get_datasets_by_project(project_id: int, db: Session = Depends(get_db)):
    datasets = db.query(models.Dataset).filter(models.Dataset.project_id == project_id).all()
    return datasets
