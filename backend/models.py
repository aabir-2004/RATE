from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    email = Column(String, unique=True, index=True)
    role = Column(String, default="Analyst")
    password_hash = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    projects = relationship("Project", back_populates="owner")

class Project(Base):
    __tablename__ = "projects"

    project_id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    description = Column(Text)
    owner_id = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="projects")
    datasets = relationship("Dataset", back_populates="project")

class Dataset(Base):
    __tablename__ = "datasets"

    dataset_id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.project_id"))
    file_name = Column(String)
    domain = Column(String)
    rows = Column(Integer)
    columns = Column(Integer)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="datasets")
    preprocessing_runs = relationship("PreprocessingRun", back_populates="dataset")

class PreprocessingRun(Base):
    __tablename__ = "preprocessing_runs"

    run_id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.dataset_id"))
    operations = Column(JSON) # Store list of operations applied
    timestamp = Column(DateTime, default=datetime.utcnow)

    dataset = relationship("Dataset", back_populates="preprocessing_runs")
    feature_selections = relationship("FeatureSelection", back_populates="preprocessing_run")

class FeatureSelection(Base):
    __tablename__ = "feature_selections"

    selection_id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("preprocessing_runs.run_id"))
    target_variable = Column(String)
    selected_features = Column(JSON) # List of feature names

    preprocessing_run = relationship("PreprocessingRun", back_populates="feature_selections")
    factor_assessments = relationship("FactorAssessment", back_populates="feature_selection")

class FactorAssessment(Base):
    __tablename__ = "factor_assessments"
    
    assessment_id = Column(Integer, primary_key=True, index=True)
    selection_id = Column(Integer, ForeignKey("feature_selections.selection_id"))
    method = Column(String) # e.g., 'correlation', 'random_forest'
    results_json = Column(JSON) # Store scores and rankings
    timestamp = Column(DateTime, default=datetime.utcnow)

    feature_selection = relationship("FeatureSelection", back_populates="factor_assessments")
    model_runs = relationship("ModelRun", back_populates="factor_assessment")

class ModelRun(Base):
    __tablename__ = "model_runs"

    model_run_id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("factor_assessments.assessment_id"))
    algorithm = Column(String)
    metrics_json = Column(JSON) # e.g., {"accuracy": 0.85, ...}
    timestamp = Column(DateTime, default=datetime.utcnow)

    factor_assessment = relationship("FactorAssessment", back_populates="model_runs")
    novelty_cases = relationship("NoveltyCase", back_populates="model_run")

class NoveltyCase(Base):
    __tablename__ = "novelty_cases"

    case_id = Column(Integer, primary_key=True, index=True)
    model_run_id = Column(Integer, ForeignKey("model_runs.model_run_id"))
    reason = Column(String)
    reviewer_notes = Column(Text, nullable=True)
    action_taken = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    model_run = relationship("ModelRun", back_populates="novelty_cases")

class Report(Base):
    __tablename__ = "reports"

    report_id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.project_id"))
    file_path = Column(String)
    generated_at = Column(DateTime, default=datetime.utcnow)
