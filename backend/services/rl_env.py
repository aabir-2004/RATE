import gymnasium as gym
from gymnasium import spaces
import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.model_selection import cross_val_score

class FeatureSelectionEnv(gym.Env):
    """
    Custom Environment for Feature Selection using Reinforcement Learning.
    The agent learns to select a subset of features that maximizes predictive performance.
    It now incorporates ANOVA metadata directly into its observation space.
    """
    metadata = {'render.modes': ['console']}

    def __init__(self, X: pd.DataFrame, y: pd.Series, is_classification: bool, anova_metadata: np.ndarray):
        super(FeatureSelectionEnv, self).__init__()
        
        self.X = X
        self.y = y
        self.is_classification = is_classification
        self.n_features = X.shape[1]
        self.anova_metadata = anova_metadata.astype(np.float32)
        
        # Action space: Discrete to toggle one feature at a time.
        self.action_space = spaces.Discrete(self.n_features)
        
        # Observation space: Concatenation of current binary selection AND ANOVA continuous metadata
        self.observation_space = spaces.Box(low=0.0, high=1.0, shape=(self.n_features * 2,), dtype=np.float32)
        
        self.state = np.zeros(self.n_features, dtype=np.float32)
        self.current_step = 0
        self.max_steps = self.n_features * 2
        
        # Fast evaluator
        self.evaluator = DecisionTreeClassifier(max_depth=5) if self.is_classification else DecisionTreeRegressor(max_depth=5)
        self.best_score = -float('inf')

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.state = np.zeros(self.n_features, dtype=np.float32)
        # Select at least one random feature to avoid evaluating empty set initially
        initial_feature = np.random.randint(self.n_features)
        self.state[initial_feature] = 1.0
        
        self.current_step = 0
        self.best_score = -float('inf')
        
        obs = np.concatenate([self.state, self.anova_metadata])
        return obs, {}

    def step(self, action):
        self.current_step += 1
        
        # Toggle the feature selection
        self.state[action] = 1.0 - self.state[action]
        
        # If no features are selected, penalize heavily and randomly pick one
        if np.sum(self.state) == 0:
            reward = -1.0
            self.state[np.random.randint(self.n_features)] = 1.0
            score = 0.0
        else:
            # Evaluate current feature subset
            selected_features_idx = np.where(self.state == 1.0)[0]
            X_subset = self.X.iloc[:, selected_features_idx]
            
            # Use cross-validation for robust fast scoring
            if self.is_classification:
                scores = cross_val_score(self.evaluator, X_subset, self.y, cv=3, scoring='accuracy')
            else:
                # For regression, metrics are negative so higher is better
                scores = cross_val_score(self.evaluator, X_subset, self.y, cv=3, scoring='r2')
                
            score = np.mean(scores)
            
            # Reward shaping: Increase in performance + penalty for number of features (sparsity)
            sparsity_penalty = 0.01 * np.sum(self.state)
            
            if self.best_score == -float('inf'):
                # Initial evaluation step shouldn't yield infinite reward
                reward = 1.0 - sparsity_penalty
                self.best_score = score
            elif score > self.best_score:
                reward = (score - self.best_score) * 10 - sparsity_penalty
                self.best_score = score
            else:
                # Small penalty for step without improvement
                reward = -0.05 - sparsity_penalty
                
        terminated = self.current_step >= self.max_steps
        truncated = False
        
        obs = np.concatenate([self.state, self.anova_metadata])
        return obs, reward, terminated, truncated, {"score": score}

    def render(self, mode='console'):
        if mode == 'console':
            print(f"Step: {self.current_step}, State: {self.state}, Best Score: {self.best_score}")

def run_rl_feature_selection(df: pd.DataFrame, target_col: str, total_timesteps=2000):
    from stable_baselines3 import PPO
    from sklearn.feature_selection import f_classif, f_regression
    
    X = df.drop(columns=[target_col])
    y = df[target_col]
    is_classification = df[target_col].nunique() < 20
    
    # 1. ANOVA Pre-Processing (Metadata of data layer)
    if is_classification:
        f_values, _ = f_classif(X, y)
    else:
        f_values, _ = f_regression(X, y)
        
    f_values = np.nan_to_num(f_values)
    # Normalize between 0 and 1 so RL network handles it cleanly
    f_max = np.max(f_values) if np.max(f_values) > 0 else 1.0
    anova_metadata = f_values / f_max
    
    env = FeatureSelectionEnv(X, y, is_classification, anova_metadata)
    
    # Using PPO architecture suitable for continuous Box observation spaces
    model = PPO("MlpPolicy", env, verbose=0, n_steps=64, batch_size=32)
    model.learn(total_timesteps=total_timesteps)
    
    # Evaluate the learned policy to get feature importance
    obs, info = env.reset()
    feature_counts = np.zeros(X.shape[1])
    
    # Sample from policy multiple times to ascertain robust variable inclusion
    for _ in range(50): 
        action, _states = model.predict(obs, deterministic=True)
        obs, reward, terminated, truncated, info = env.step(action)
        # Which features are active? (The first n_features of obs hold the binary state)
        feature_counts += obs[:X.shape[1]]
        if terminated or truncated:
            obs, info = env.reset()
            
    # Normalize relevance scores
    importance_scores = feature_counts / np.max([np.max(feature_counts), 1])
    
    results = {X.columns[i]: float(importance_scores[i]) for i in range(len(X.columns))}
    return dict(sorted(results.items(), key=lambda item: item[1], reverse=True))

