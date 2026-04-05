from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import pandas as pd
import os

from .. import models, schemas
from ..database import get_db
from ..services.ml_services import preprocess_dataset

router = APIRouter(prefix="/preprocessing", tags=["Preprocessing"])

@router.post("/", response_model=schemas.PreprocessingResponse)
async def run_preprocessing(request: schemas.PreprocessingCreate, db: Session = Depends(get_db)):
    dataset = db.query(models.Dataset).filter(models.Dataset.dataset_id == request.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    file_path = f"uploads/{dataset.dataset_id}_dataset.csv"
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset file not found on server")
        
    df = pd.read_csv(file_path)
    options_dict = request.options.model_dump()
    
    try:
        processed_df, log = preprocess_dataset(df, options_dict)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preprocessing failed: {str(e)}")
        
    # Create the run in DB to get run_id
    run = models.PreprocessingRun(
        dataset_id=request.dataset_id,
        operations=log
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    
    # Save processed dataframe
    new_path = f"uploads/run_{run.run_id}_dataset.csv"
    processed_df.to_csv(new_path, index=False)
    
    return run

@router.post("/feature-selection", response_model=schemas.FeatureSelectionResponse)
async def create_feature_selection(request: schemas.FeatureSelectionCreate, db: Session = Depends(get_db)):
    run = db.query(models.PreprocessingRun).filter(models.PreprocessingRun.run_id == request.run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Preprocessing run not found")
        
    selection = models.FeatureSelection(
        run_id=request.run_id,
        target_variable=request.target_variable,
        selected_features=request.selected_features
    )
    db.add(selection)
    db.commit()
    db.refresh(selection)
    return selection
