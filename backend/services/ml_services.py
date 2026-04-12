import pandas as pd
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.feature_selection import f_classif, f_regression
import numpy as np

from backend.services.rl_env import run_rl_feature_selection

def preprocess_dataset(df: pd.DataFrame, options: dict) -> tuple[pd.DataFrame, dict]:
    """
    Applies preprocessing steps to a DataFrame based on user options.
    """
    log = {}
    
    # Missing Values
    if options.get("handle_missing") == "mean":
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].mean())
        log["handle_missing"] = "mean imputation applied to numeric columns"
    elif options.get("handle_missing") == "drop":
        initial_rows = len(df)
        df = df.dropna()
        log["handle_missing"] = f"dropped {initial_rows - len(df)} missing value rows"

    # Encoding Categorical Variables
    if options.get("encode_categorical", True):
        cat_cols = df.select_dtypes(include=['object', 'category']).columns
        encoders = {}
        for col in cat_cols:
            le = LabelEncoder()
            df[col] = pd.Series(le.fit_transform(df[col].astype(str)), index=df.index)
            encoders[col] = "LabelEncoded"
        log["encoded_columns"] = list(cat_cols)

    # Normalization
    if options.get("normalize", False):
        scaler = StandardScaler()
        cols = df.columns
        df[cols] = scaler.fit_transform(df[cols])
        log["normalization"] = "StandardScaler applied"

    return df, log

def assess_factors(df: pd.DataFrame, target_col: str, method: str, llm_priors: list = None) -> dict:
    """
    Ranks factors based on the selected method. Incorporates LLM priors if provided.
    """
    if target_col not in df.columns:
        raise ValueError(f"Target column '{target_col}' not found.")

    X = df.drop(columns=[target_col])
    y = df[target_col]
    
    results = {}
    
    if method == "correlation":
        corr_matrix = df.corr()
        target_corr = corr_matrix[target_col].drop(target_col)
        sorted_corr = target_corr.abs().sort_values(ascending=False)
        results = sorted_corr.to_dict()
        
    elif method == "random_forest":
        # Assume regression for testing, a robust implementation would check if target is continuous/categorical
        is_classification = df[target_col].nunique() < 20 # heuristic
        
        if is_classification:
            model = RandomForestClassifier(n_estimators=100, random_state=42)
        else:
            model = RandomForestRegressor(n_estimators=100, random_state=42)
            
        model.fit(X, y)
        importances = model.feature_importances_
        indices = np.argsort(importances)[::-1]
        
        for f in range(X.shape[1]):
            results[X.columns[indices[f]]] = importances[indices[f]]
            
    elif method == "anova":
        is_classification = df[target_col].nunique() < 20 # heuristic
        if is_classification:
            f_values, p_values = f_classif(X, y)
        else:
            f_values, p_values = f_regression(X, y)
            
        # Handle NaNs from constant features
        f_values = np.nan_to_num(f_values)
        
        indices = np.argsort(f_values)[::-1]
        for f in range(X.shape[1]):
            # Return F-score as ranking metric
            results[X.columns[indices[f]]] = float(f_values[indices[f]])
            
    elif method == "reinforcement_learning":
        # Launch the Deep RL PPO agent to identify optimal feature subset
        # Timesteps optimized to 250 to comply with Vercel's 10s serverless timeout constraint
        results = run_rl_feature_selection(df, target_col, total_timesteps=250, llm_priors=llm_priors)
            
    return {"method": method, "rankings": results}

def evaluate_model(df: pd.DataFrame, target_col: str, feature_cols: list, algorithm: str) -> dict:
    """
    Evaluate a model using specific features.
    """
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import mean_squared_error, r2_score, accuracy_score, precision_score
    
    X = df[feature_cols]
    y = df[target_col]
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    metrics = {}
    is_classification = df[target_col].nunique() < 20
    
    if algorithm == "random_forest":
         if is_classification:
             model = RandomForestClassifier(n_estimators=100, random_state=42)
             model.fit(X_train, y_train)
             preds = model.predict(X_test)
             metrics["accuracy"] = float(accuracy_score(y_test, preds))
             # Handle precision possibly being undefined for 0 division
             # metrics["precision"] = float(precision_score(y_test, preds, average='weighted', zero_division=0))
         else:
             model = RandomForestRegressor(n_estimators=100, random_state=42)
             model.fit(X_train, y_train)
             preds = model.predict(X_test)
             metrics["mse"] = float(mean_squared_error(y_test, preds))
             metrics["r2"] = float(r2_score(y_test, preds))
             
    return metrics
