from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List
import pandas as pd
import io
import os
import shutil
import glob

from backend import models, schemas
from backend.database import get_db

router = APIRouter(prefix="/datasets", tags=["Datasets"])

# ── Hard File Size Limit ──────────────────────────────────────────────
MAX_FILE_SIZE_MB = 100  # Reject any single upload exceeding 100 MB


@router.post("/upload_chunk")
def upload_chunk(
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    file: UploadFile = File(...)
):
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

    # ── Reassemble the chunked file ───────────────────────────────────
    final_temp_path = f"uploads/assembled_{upload_id}_{file_name}"
    with open(final_temp_path, "wb") as final_file:
        for i in range(total_chunks):
            chunk_path = f"uploads/temp_{upload_id}/chunk_{i}"
            if not os.path.exists(chunk_path):
                raise HTTPException(status_code=400, detail=f"Missing chunk {i}")
            with open(chunk_path, "rb") as chunk_file:
                shutil.copyfileobj(chunk_file, final_file)

    # ── Hard Size Gate ────────────────────────────────────────────────
    file_size_mb = os.path.getsize(final_temp_path) / (1024 * 1024)
    if file_size_mb > MAX_FILE_SIZE_MB:
        os.remove(final_temp_path)
        shutil.rmtree(f"uploads/temp_{upload_id}", ignore_errors=True)
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({file_size_mb:.1f} MB). Maximum allowed is {MAX_FILE_SIZE_MB} MB."
        )

    # ── Parse metadata only ───────────────────────────────────────────
    try:
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
        shutil.rmtree(f"uploads/temp_{upload_id}", ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")

    # ── Persist metadata in lightweight SQLite ────────────────────────
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

    # ── Keep the assembled CSV temporarily for ML processing ─────────
    # This file will be purged AFTER analysis completes (see /purge-session)
    file_path = f"uploads/{db_dataset.dataset_id}_dataset.csv"

    if file_name.endswith('.csv'):
        os.rename(final_temp_path, file_path)
    else:
        df.to_csv(file_path, index=False)
        os.remove(final_temp_path)

    # Cleanup temp chunk directory immediately
    shutil.rmtree(f"uploads/temp_{upload_id}", ignore_errors=True)

    response_data = schemas.DatasetResponse.model_validate(db_dataset).model_dump()
    response_data["columns_list"] = columns_list
    return response_data


# ── Session Cleanup Endpoint ──────────────────────────────────────────
# Called by the frontend after analysis results are received,
# or can be called manually to free all temporary files.
@router.post("/purge-session")
def purge_session(dataset_ids: List[int] = []):
    """
    Deletes raw CSV files from the server for the given dataset IDs.
    If no IDs are provided, purges ALL uploaded files (nuclear cleanup).
    This keeps the backend ephemeral — no data lingers after the session.
    """
    purged = []
    if dataset_ids:
        for did in dataset_ids:
            # Purge raw upload
            raw_path = f"uploads/{did}_dataset.csv"
            if os.path.exists(raw_path):
                os.remove(raw_path)
                purged.append(raw_path)
            # Purge any preprocessed run files linked to this dataset
            for run_file in glob.glob(f"uploads/run_*_dataset.csv"):
                os.remove(run_file)
                purged.append(run_file)
    else:
        # Nuclear: purge everything in uploads/
        for f in glob.glob("uploads/*.csv"):
            os.remove(f)
            purged.append(f)
        for d in glob.glob("uploads/temp_*"):
            shutil.rmtree(d, ignore_errors=True)
            purged.append(d)

    return {"status": "purged", "files_removed": len(purged), "details": purged}


@router.get("/project/{project_id}", response_model=List[schemas.DatasetResponse])
def get_datasets_by_project(project_id: int, db: Session = Depends(get_db)):
    datasets = db.query(models.Dataset).filter(models.Dataset.project_id == project_id).all()
    return datasets
