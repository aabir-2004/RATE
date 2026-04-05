# R.A.T.E. Backend Implementation Log

## Overview
This document logs the development process of the backend for the R.A.T.E. (Reinforcement-based Assessment of Target Elements: Factor Assessment System). It details the technical parameters, function definitions, database schemas, and how various files interconnect.

## Tech Stack Chosen
*   **Web Framework:** FastAPI (Python) - Chosen for its high performance, automatic interactive API documentation (Swagger UI), and tight integration with Pydantic for data validation, which is crucial when handling diverse ML datasets.
*   **Database:** SQLite - Chosen as a lightweight, zero-configuration relational database fitting the initial requirements without needing dedicated database server setup.
*   **ORM:** SQLAlchemy - Used for defining database models and interacting with SQLite.
*   **Data Processing & ML:** `pandas`, `scikit-learn`, `numpy` - Standard libraries for preprocessing tabular data, calculating correlations, and running regression and tree-based models (Random Forest).

## System Architecture & File Structure
*   `backend/main.py`: Entry point for the FastAPI application. Sets up CORS, and includes the routers for different API sections.
*   `backend/database.py`: Handles SQLAlchemy engine, session maker, and Base declarative class.
*   `backend/models.py`: Defines the relational database tables using SQLAlchemy (e.g., `User`, `Project`, `Dataset`, `AnalysisRun`).
*   `backend/schemas.py`: Defines Pydantic models used to validate incoming JSON payloads and format outgoing JSON responses (e.g., `DatasetCreate`, `DatasetResponse`).
*   `backend/api/`: Directory containing sub-routers for different functional modules (datasets, preprocessing, analysis, user management).
*   `backend/services/`: Directory containing business logic. Specifically, `ml_services.py` will abstract the `pandas` and `scikit-learn` logic away from the API endpoints.

## Database Implementation
Database initialization successfully created the `rate_app.db` file. The schemas are fully implemented based on the provided JSON requirements. The tables are logically linked to build up the analysis hierarchy:
1.  **Users** and **Projects** represent standard hierarchical ownership.
2.  **Datasets** are linked to projects.
3.  **PreprocessingRuns** trace actions done on a particular dataset.
4.  **FeatureSelections** connect to preprocessing runs and capture the chosen target & input features.
5.  **FactorAssessments** record feature ranking runs (correlation, RF, etc.) linked to feature selections.
6.  **ModelRuns** evaluate those features metrics and are linked to FactorAssessment.
7.  **NoveltyCases** allow reviewers to interact closely with specific instances from model runs.

## API Schemas (Pydantic)
I've defined Data Transfer Objects (DTOs) using Pydantic in `backend/schemas.py`. These ensure input validation and filter output serialization.
*   **Create Schemas**: E.g., `UserCreate`, `DatasetCreate`. These often include passwords or parent IDs.
*   **Response Schemas**: E.g., `DatasetResponse`. These map to `ORMModel` which enables reading data from SQLAlchemy model properties directly and excludes sensitive data (like password hashes).

## Machine Learning Services
The core intelligence of R.A.T.E. is located in `backend/services/ml_services.py` and `backend/services/rl_env.py`.
*   `preprocess_dataset(...)`: Cleans data based on user configuration. Connects directly to FR-9 through FR-12. Returns modified dataframe and a log of what was done.
*   `assess_factors(df, target_col, method)`: Implements comprehensive feature ranking logic. Sub-methods include:
    *   **ANOVA (`f_classif`, `f_regression`)**: Implemented to evaluate statistical significance directly from feature variance.
    *   **Correlation**: Fast monotonic linear relationship extraction.
    *   **Random Forest**: Tree-based impurity importance, dynamically adapting between regression and classification.
    *   **Reinforcement Learning (PPO)**: Instantiates a custom `gymnasium` environment (`FeatureSelectionEnv`) using `stable-baselines3`. The RL agent navigates the discrete feature space to optimize a reward function balanced between cross-validated predictive performance and sparsity (model compactness). Connects deeply to the R.A.T.E RL foundation.
*   `evaluate_model(...)`: Trains a model on the provided column subsets, tests it using an 80/20 train/test split, and outputs relevant metrics (accuracy for classification, MSE/R2 for regression). Maps to FR-32 to FR-36.

## API Routers
## API Routers
*   `backend/api/datasets.py`: Handles file uploads using `UploadFile`. It reads the bytes directly into a pandas dataframe (handling both CSV and Excel as per FR-4) to extract metadata (rows/columns) before saving the Dataset record to the database.
*   `backend/api/analysis.py`: Contains the endpoints for `assess-factors` and `evaluate-model`. It retrieves previously configured selections from the database, runs the corresponding `ml_services` function, and stores the JSON output. Crucially, it also implements **FR-37 (Novelty Case Handling)**: if a model evaluation returns exceptionally poor results (e.g., accuracy < 0.6), it automatically generates a `NoveltyCase` database record tied to that model run to prompt manual review. 
 
## Application Initialization
*   `backend/main.py`: This is the FastAPI execution context. It builds the declarative base models, constructs the application (`app`), assigns CORS headers (enabling local frontend development against it), and includes all the routers. It also defines a `/` health-check endpoint.
*   `run.sh`: I've created an executable shell script at the project root which auto-detects/installs the virtual environment dependencies and launches the `uvicorn` development server with hot-reloading on port 8000. It ties the backend together into a seamless startup experience.

## Next Steps
The backend base implementation completes the structural foundation defined by the SRS JSON file. We can now review this logic before moving to frontend integrations or adding further ML abstractions.
