import gymnasium as gym
from gymnasium import spaces
import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.model_selection import cross_val_score

class FeatureSelectionEnv(gym.Env):
    """
    Custom Environment for Feature Selection using Reinforcement Learning.
    The agent learns to select a subset of features that maximizes predictive performance
    while minimizing the number of features.
    """
    metadata = {'render.modes': ['console']}

    def __init__(self, X: pd.DataFrame, y: pd.Series, is_classification: bool):
        super(FeatureSelectionEnv, self).__init__()
        
        self.X = X
        self.y = y
        self.is_classification = is_classification
        self.n_features = X.shape[1]
        
        # Action space: Two actions for each feature (1: select, 0: unselect)
        # We can formulate action space as MultiBinary to select/deselect multiple at once
        # or as Discrete to toggle one feature at a time.
        # Discrete is often easier for simple RL agents to explore effectively.
        self.action_space = spaces.Discrete(self.n_features)
        
        # Observation space: Binary vector of current feature selection state
        self.observation_space = spaces.MultiBinary(self.n_features)
        
        self.state = np.zeros(self.n_features, dtype=np.int8)
        self.current_step = 0
        self.max_steps = self.n_features * 2
        
        # Fast evaluator
        self.evaluator = DecisionTreeClassifier(max_depth=5) if self.is_classification else DecisionTreeRegressor(max_depth=5)
        self.best_score = -float('inf')

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        # Start with all features unselected (or randomly selected)
        self.state = np.zeros(self.n_features, dtype=np.int8)
        # Select at least one random feature to avoid evaluating empty set initially
        initial_feature = np.random.randint(self.n_features)
        self.state[initial_feature] = 1
        
        self.current_step = 0
        self.best_score = -float('inf')
        return self.state, {}

    def step(self, action):
        self.current_step += 1
        
        # Toggle the feature selection
        self.state[action] = 1 - self.state[action]
        
        # If no features are selected, penalize heavily and randomly pick one
        if np.sum(self.state) == 0:
            reward = -1.0
            self.state[np.random.randint(self.n_features)] = 1
            score = 0.0
        else:
            # Evaluate current feature subset
            selected_features_idx = np.where(self.state == 1)[0]
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
            
            if score > self.best_score:
                reward = (score - self.best_score) * 10 - sparsity_penalty
                self.best_score = score
            else:
                # Small penalty for step without improvement
                reward = -0.05 - sparsity_penalty
                
        terminated = self.current_step >= self.max_steps
        truncated = False
        
        return self.state, reward, terminated, truncated, {"score": score}

    def render(self, mode='console'):
        if mode == 'console':
            print(f"Step: {self.current_step}, State: {self.state}, Best Score: {self.best_score}")

def run_rl_feature_selection(df: pd.DataFrame, target_col: str, total_timesteps=2000):
    from stable_baselines3 import PPO
    
    X = df.drop(columns=[target_col])
    y = df[target_col]
    is_classification = df[target_col].nunique() < 20
    
    env = FeatureSelectionEnv(X, y, is_classification)
    
    # Using PPO architecture suitable for MultiBinary observation
    model = PPO("MlpPolicy", env, verbose=0, n_steps=64, batch_size=32)
    model.learn(total_timesteps=total_timesteps)
    
    # Evaluate the learned policy to get feature importance
    # Run an episode following policy, sum up selections
    obs, info = env.reset()
    feature_counts = np.zeros(X.shape[1])
    
    # Sample from policy multiple times to ascertain robust variable inclusion
    for _ in range(50): 
        action, _states = model.predict(obs, deterministic=True)
        obs, reward, terminated, truncated, info = env.step(action)
        # Which features are active?
        feature_counts += obs
        if terminated or truncated:
            obs, info = env.reset()
            
    # Normalize relevance scores
    importance_scores = feature_counts / np.max([np.max(feature_counts), 1])
    
    results = {X.columns[i]: float(importance_scores[i]) for i in range(len(X.columns))}
    return dict(sorted(results.items(), key=lambda item: item[1], reverse=True))

