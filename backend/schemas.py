from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

# Common
class ORMModel(BaseModel):
    model_config = {"from_attributes": True}

# --- User Schemas ---
class UserBase(BaseModel):
    name: str
    email: str
    role: Optional[str] = "Analyst"

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase, ORMModel):
    user_id: int
    created_at: datetime

# --- Project Schemas ---
class ProjectBase(BaseModel):
    title: str
    description: Optional[str] = None

class ProjectCreate(ProjectBase):
    owner_id: int

class ProjectResponse(ProjectBase, ORMModel):
    project_id: int
    owner_id: int
    created_at: datetime

# --- Dataset Schemas ---
class DatasetBase(BaseModel):
    file_name: str
    domain: str
    rows: int
    columns: int

class DatasetCreate(DatasetBase):
    project_id: int

class DatasetResponse(DatasetBase, ORMModel):
    dataset_id: int
    project_id: int
    uploaded_at: datetime
    columns_list: Optional[List[str]] = None

# --- Preprocessing Schemas ---
class PreprocessingOptions(BaseModel):
    handle_missing: str = "mean" # mean, drop
    normalize: bool = False
    encode_categorical: bool = True

class PreprocessingCreate(BaseModel):
    dataset_id: int
    options: PreprocessingOptions

class PreprocessingResponse(ORMModel):
    run_id: int
    dataset_id: int
    operations: Dict[str, Any]
    timestamp: datetime

# --- Feature Selection ---
class FeatureSelectionCreate(BaseModel):
    run_id: int
    target_variable: str
    selected_features: List[str]

class FeatureSelectionResponse(ORMModel):
    selection_id: int
    run_id: int
    target_variable: str
    selected_features: List[str]

# --- Factor Assessment ---
class FactorAssessmentCreate(BaseModel):
    selection_id: int
    method: str

class FactorAssessmentResponse(ORMModel):
    assessment_id: int
    selection_id: int
    method: str
    results_json: Dict[str, Any]
    timestamp: datetime

# --- Model Run ---
class ModelRunCreate(BaseModel):
    assessment_id: int
    algorithm: str # e.g. RandomForestRegressor

class ModelRunResponse(ORMModel):
    model_run_id: int
    assessment_id: int
    algorithm: str
    metrics_json: Dict[str, Any]
    timestamp: datetime

# --- Novelty Case ---
class NoveltyCaseCreate(BaseModel):
    model_run_id: int
    reason: str

class NoveltyCaseUpdate(BaseModel):
    reviewer_notes: Optional[str] = None
    action_taken: Optional[str] = None

class NoveltyCaseResponse(ORMModel):
    case_id: int
    model_run_id: int
    reason: str
    reviewer_notes: Optional[str]
    action_taken: Optional[str]
    timestamp: datetime
