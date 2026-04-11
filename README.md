# R.A.T.E — Reinforced Analytical Target Engine

R.A.T.E is a deterministic system for automated feature selection and dataset evaluation. It integrates structured LLM outputs with statistical validation and reinforcement learning to produce reproducible and verifiable analytical results.

The system is designed to address a common failure mode in AI-assisted data pipelines: the use of non-deterministic or unverified feature logic. R.A.T.E enforces a strict boundary between structural inference and mathematical execution, ensuring that all computations are grounded in validated data.

---

## System Overview

At a high level, the pipeline converts raw tabular data into an optimized feature subset through a sequence of constrained transformations. Each stage is designed to eliminate ambiguity before passing control to the next.

Dataset → Metadata Extraction → LLM Structuring  
→ Schema Validation → ANOVA Processing  
→ RL Optimization (PPO) → Ranking Output  

The LLM is used only to propose an initial structure. All subsequent stages operate on validated inputs and deterministic processes.

---

## Design Principles

The system is built around a few core constraints:

- LLMs are not allowed to perform numerical reasoning  
- All feature references must exist in the dataset schema  
- Every stochastic component is seeded for reproducibility  
- Invalid inputs are removed before entering the execution pipeline  

This ensures that the system behaves consistently across runs and datasets, without relying on probabilistic outputs from generative models.

---

## Pipeline Description

### Dataset Ingestion

Datasets are uploaded in fixed-size chunks and reconstructed server-side. This avoids memory spikes and allows handling of large files within constrained environments.

### Metadata and LLM Structuring

Only column headers are passed to the LLM. The model returns a structured JSON containing a proposed target variable and candidate features. No statistical or numerical inference is accepted at this stage.

### Validation Layer

The proposed schema is cross-checked against the actual dataset. Any invalid or hallucinated feature is removed before further processing. This step acts as a hard gate for pipeline integrity.

### Statistical Processing (ANOVA)

ANOVA is applied to compute feature relevance with respect to the target variable. The output is a set of statistically grounded signals that serve as input for the optimization stage.

### Reinforcement Learning Optimization

A PPO-based agent operates over a binary feature selection space. The initial state is seeded using the validated LLM output, allowing the agent to start from a structured prior rather than a random configuration.

The reward function is derived from model performance (e.g., a Random Forest baseline), and the agent iteratively converges toward an optimal feature subset.

### Output

The system produces:
- Ranked feature importance
- Evaluation metrics
- Final selected feature set

---

## Architecture

<img width="1536" height="1024" alt="ChatGPT Image Apr 12, 2026, 01_46_53 AM" src="https://github.com/user-attachments/assets/c3b47141-b92a-4b3f-bcf2-c84df416cd05" />


The backend is implemented using FastAPI and handles all data processing and model execution. Reinforcement learning is implemented using Stable-Baselines3, with a custom environment for feature selection.

The frontend is built with Next.js and provides a controlled interface for dataset upload, pipeline execution, and result visualization.

A Redis layer is used for caching previously computed results, reducing redundant computation for identical inputs.

---

## Determinism and Reliability

Reproducibility is enforced across all stages:

- Fixed random seeds are applied globally  
- LLM output is treated as input, not authority  
- All computations occur after validation  
- No stage depends on unverified assumptions  

This ensures that identical inputs always produce identical outputs.

---

## Deployment

The system is containerized using Docker. Separate services are defined for:

- Python API  
- Frontend (Next.js)  
- Redis (caching)  
- MongoDB (persistence)  

All services communicate over an isolated internal network, allowing consistent deployment across environments.

---

## Limitations

The system currently assumes structured tabular datasets. Performance may degrade with very high-dimensional feature spaces due to RL training cost. ANOVA is used as a primary statistical filter and may not capture complex non-linear relationships.

---

## License

All rights reserved.

Unauthorized copying, modification, distribution, or use of this software, in whole or in part, is strictly prohibited without prior written permission from the author.
