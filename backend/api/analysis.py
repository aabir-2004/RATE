from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import pandas as pd
import numpy as np

from .. import models, schemas
from ..database import get_db
from ..services.ml_services import assess_factors, evaluate_model # Assuming preprocessing is done

router = APIRouter(prefix="/analysis", tags=["Analysis"])

@router.post("/assess-factors", response_model=schemas.FactorAssessmentResponse)
def run_factor_assessment(request: schemas.FactorAssessmentCreate, db: Session = Depends(get_db)):
    selection = db.query(models.FeatureSelection).filter(models.FeatureSelection.selection_id == request.selection_id).first()
    if not selection:
        raise HTTPException(status_code=404, detail="Feature selection not found")
        
    # Load the processed dataset based on selection's parent preprocessing run
    import os
    run_id = selection.preprocessing_run.run_id
    file_path = f"uploads/run_{run_id}_dataset.csv"
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset for this selection cannot be found.")
        
    df = pd.read_csv(file_path)
    
    try:
        results = assess_factors(df, selection.target_variable, request.method, request.llm_priors)
    except Exception as e:
         raise HTTPException(status_code=500, detail=str(e))
         
    # Save to db
    assessment = models.FactorAssessment(
        selection_id=request.selection_id,
        method=request.method,
        results_json=results
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment
    
@router.post("/evaluate-model", response_model=schemas.ModelRunResponse)
def run_model_evaluation(request: schemas.ModelRunCreate, db: Session = Depends(get_db)):
    assessment = db.query(models.FactorAssessment).filter(models.FactorAssessment.assessment_id == request.assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Factor assessment not found")
        
    selection = assessment.feature_selection
        
    import os
    run_id = selection.preprocessing_run.run_id
    file_path = f"uploads/run_{run_id}_dataset.csv"
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset for this selection cannot be found.")
        
    df = pd.read_csv(file_path)
    
    # Ensure feature cols are constrained accurately
    feature_cols = selection.selected_features
    if not feature_cols:
        raise HTTPException(status_code=400, detail="No selected features found. Cannot evaluate.")

    try:
        metrics = evaluate_model(df, selection.target_variable, feature_cols, request.algorithm)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    model_run = models.ModelRun(
        assessment_id=request.assessment_id,
        algorithm=request.algorithm,
        metrics_json=metrics
    )
    db.add(model_run)
    db.commit()
    db.refresh(model_run)
    
    # Dummy Reinforcement/Novelty Check (FR-37)
    if "accuracy" in metrics and metrics["accuracy"] < 0.6:
        novelty = models.NoveltyCase(
            model_run_id=model_run.model_run_id,
            reason="Low model accuracy detected. Review factors."
        )
        db.add(novelty)
        db.commit()
    
    return model_run
