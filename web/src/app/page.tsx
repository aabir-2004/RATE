'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function Home() {
    const [view, setView] = useState('landing');
    const [theme, setTheme] = useState('dark');
    
    // API States
    const [datasetId, setDatasetId] = useState<number | null>(null);
    const [runId, setRunId] = useState<number | null>(null);
    const [availableColumns, setAvailableColumns] = useState<string[]>([]);
    
    // Multi-Dataset Pipeline & Groq Integration
    const [numFiles, setNumFiles] = useState<number>(1);
    const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
    const [multiDatasets, setMultiDatasets] = useState<any[]>([]);
    const [llmInsight, setLlmInsight] = useState<any>(null);
    const [llmLoading, setLlmLoading] = useState<boolean>(false);

    // UI Feedback
    const [uploadAlert, setUploadAlert] = useState<{msg: string, type: string} | null>(null);
    const [analysisAlert, setAnalysisAlert] = useState<{msg: string, type: string} | null>(null);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
    const [analysisResults, setAnalysisResults] = useState<any>(null);
    const [resultSource, setResultSource] = useState<string>('');
    
    // Chart References
    const rankChartRef = useRef<HTMLCanvasElement>(null);
    const chartInstances = useRef<{rank: any}>({ rank: null });

    useEffect(() => {
        document.body.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        if (view === 'analysis' && rankChartRef.current) {
             if (chartInstances.current.rank) chartInstances.current.rank.destroy();
             
             chartInstances.current.rank = new Chart(rankChartRef.current, {
                type: 'bar',
                data: {
                    labels: ['Awaiting analysis...'],
                    datasets: [{ 
                        label: 'Factor Importance Score', 
                        data: [0], 
                        backgroundColor: 'rgba(0, 191, 165, 0.6)',
                        borderColor: 'rgba(0, 191, 165, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                    }]
                },
                options: { 
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                    },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--text-secondary)' }},
                        y: { grid: { display: false }, ticks: { color: 'var(--text-primary)', font: { weight: 'bold' as any }}}
                    }
                }
            });
        }
    }, [view, theme]);

    const uploadDataset = async (e: React.FormEvent) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const fileInput = form.elements.namedItem('datasetFile') as HTMLInputElement;
        const domain = (form.elements.namedItem('domainSelect') as HTMLSelectElement).value;

        if (!fileInput.files || fileInput.files.length === 0) {
            setUploadAlert({ msg: 'Please select a file first.', type: 'alert-error' });
            return;
        }

        const file = fileInput.files[0];
        
        // Hard size validation (matches backend 100MB limit)
        if (file.size > 100 * 1024 * 1024) {
            setUploadAlert({ msg: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 100 MB.`, type: 'alert-error' });
            return;
        }
        
        const chunkSize = 5 * 1024 * 1024; // 5MB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        const uploadId = crypto.randomUUID(); 
        const pythonWorkerUrl = process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://Zeo04-rate-worker.hf.space';

        try {
            setUploadProgress(0);
            
            // Step 1: Upload sequentially in chunks
            for (let index = 0; index < totalChunks; index++) {
                const start = index * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                const formData = new FormData();
                formData.append('upload_id', uploadId);
                formData.append('chunk_index', index.toString());
                formData.append('file', chunk);
                
                const progress = Math.round(((index + 1) / totalChunks) * 80);
                setUploadProgress(progress);
                setUploadAlert({ msg: `Streaming chunk ${index + 1}/${totalChunks} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`, type: 'alert-success' });
                
                const res = await fetch(`${pythonWorkerUrl}/datasets/upload_chunk`, {
                    method: 'POST',
                    body: formData
                });
                
                if (!res.ok) throw new Error(`Chunk ${index + 1} failed to transfer.`);
            }

            // Step 2: Finalize and process
            setUploadProgress(90);
            setUploadAlert({ msg: 'Assembling & extracting metadata remotely...', type: 'alert-success' });
            
            const finalizeData = new FormData();
            finalizeData.append('upload_id', uploadId);
            finalizeData.append('file_name', file.name);
            finalizeData.append('domain', domain);
            finalizeData.append('project_id', '1');
            finalizeData.append('total_chunks', totalChunks.toString());

            const finalRes = await fetch(`${pythonWorkerUrl}/datasets/finalize_upload`, {
                method: 'POST',
                body: finalizeData
            });
            const data = await finalRes.json();
            
            if (!finalRes.ok) throw new Error(data.detail || 'Final backend processing failed.');

            setUploadProgress(100);

            // Add to multi-dataset stash
            const updatedDatasets = [...multiDatasets, data];
            setMultiDatasets(updatedDatasets);
            const nextIndex = currentFileIndex + 1;
            setCurrentFileIndex(nextIndex);

            if (nextIndex === numFiles) {
                setUploadAlert({ msg: `All ${numFiles} dataset(s) uploaded! Routing to Groq AI...`, type: 'alert-success' });
                generateLLMInsight(updatedDatasets);
            } else {
                setUploadAlert({ msg: `Dataset ${nextIndex}/${numFiles} complete. Upload next file.`, type: 'alert-success' });
            }

            setDatasetId(data.dataset_id);
            setRunId(data.dataset_id); 
            
        } catch (error: any) {
            setUploadProgress(0);
            setUploadAlert({ msg: error.message, type: 'alert-error' });
        }
    };

    const generateLLMInsight = async (datasetsData: any[]) => {
        setLlmLoading(true);
        try {
            const res = await fetch('/api/groq-insight', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ datasetsMetadata: datasetsData })
            });
            const d = await res.json();
            if(!d.success) throw new Error(d.error);
            setLlmInsight(d.insight);
            
            let allCols: string[] = [];
            datasetsData.forEach(m => allCols.push(...m.columns_list));
            setAvailableColumns(Array.from(new Set(allCols))); 
            
        } catch(err: any) {
            setUploadAlert({ msg: 'LLM Intelligence failed: ' + err.message, type: 'alert-error' });
        } finally {
            setLlmLoading(false);
        }
    };

    const triggerAssessment = async (e?: React.FormEvent, forceLLM: boolean = false) => {
        if (e) e.preventDefault();
        
        let targetVar, features, method;

        if (forceLLM && llmInsight) {
            targetVar = llmInsight.target;
            features = llmInsight.features;
            method = 'reinforcement_learning'; 
        } else if (e) {
            const form = e.target as HTMLFormElement;
            targetVar = (form.elements.namedItem('targetVar') as HTMLInputElement | HTMLSelectElement).value;
            features = availableColumns.length > 0 ? availableColumns.filter(c => c !== targetVar) : ['Auto_Detect'];
            method = (form.elements.namedItem('method') as HTMLSelectElement).value;
        } else {
            return;
        }

        // Strict Front-End Validation Layer
        if (!availableColumns.includes(targetVar)) {
            const alertMsg = forceLLM 
                ? `LLM Hallucination Blocked! Target "${targetVar}" doesn't exist in dataset.`
                : `Validation Failed: Target "${targetVar}" not found.`;
            
            if (forceLLM) setUploadAlert({ msg: alertMsg, type: 'alert-error' });
            else setAnalysisAlert({ msg: alertMsg, type: 'alert-error' });
            return;
        }

        if (forceLLM) setView('analysis');
        setIsAnalyzing(true);
        setAnalysisAlert({ msg: 'Executing deterministic pipeline: Validation → Preprocessing → RL/ANOVA...', type: 'alert-success' });
        
        try {
            const res = await fetch('/api/rate-metrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    datasetId: runId || 1, 
                    targetVariable: targetVar, 
                    features: features, 
                    method: method,
                    llmPriors: llmInsight?.features || null
                })
            });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Serverless failure');

            // Draw Chart 
            if (chartInstances.current.rank && data.data && data.data.results_json) {
                const ranks = data.data.results_json.rankings;
                const sortedEntries = Object.entries(ranks).sort((a: any, b: any) => b[1] - a[1]);
                const gradient = sortedEntries.map((_: any, i: number) => {
                    const opacity = 1 - (i * 0.06);
                    return `rgba(0, 191, 165, ${Math.max(opacity, 0.2)})`;
                });
                
                chartInstances.current.rank.data.labels = sortedEntries.map(e => e[0]);
                chartInstances.current.rank.data.datasets[0].data = sortedEntries.map(e => e[1]);
                chartInstances.current.rank.data.datasets[0].backgroundColor = gradient;
                chartInstances.current.rank.update();
                
                setAnalysisResults(data.data.results_json);
            }

            setResultSource(data.source);
            setAnalysisAlert({ msg: `Pipeline complete — ${data.source}`, type: 'alert-success' });
            
        } catch (error: any) {
            setAnalysisAlert({ msg: error.message, type: 'alert-error' });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const resetPipeline = () => {
        const pythonWorkerUrl = process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://Zeo04-rate-worker.hf.space';
        fetch(`${pythonWorkerUrl}/datasets/purge-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([]) }).catch(() => {});
        setLlmInsight(null); setCurrentFileIndex(0); setMultiDatasets([]); 
        setDatasetId(null); setRunId(null); setAvailableColumns([]);
        setUploadAlert(null); setAnalysisAlert(null); setUploadProgress(0);
        setAnalysisResults(null); setResultSource('');
    };

    return (
        <div style={{ paddingBottom: '50px' }}>
            {/* ───────── Navigation Bar ───────── */}
            <nav className="navbar glass">
                <div className="logo-container">
                    <div className="logo-icon">R</div>
                    R.A.T.E.
                </div>
                <ul className="nav-links">
                    <li className={view === 'landing' ? 'active' : ''} onClick={() => setView('landing')}>◈ HOME</li>
                    <li className={view === 'upload' ? 'active' : ''} onClick={() => setView('upload')}>⇪ PIPELINE</li>
                    <li className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}>📊 ANALYSIS</li>
                </ul>
                <div className="nav-actions">
                    <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                        {theme === 'light' ? 'Dark ☾' : 'Light ☀'}
                    </button>
                </div>
            </nav>

            {/* ───────── LANDING PAGE ───────── */}
            {view === 'landing' && (
                <main className="main-container">
                    {/* Hero Section */}
                    <div style={{ textAlign: 'center', padding: '60px 20px 40px' }}>
                        <div className="radial-graphic" style={{ margin: '0 auto 30px' }}>
                            <div className="radial-inner"></div>
                        </div>
                        <h1 style={{ fontSize: '2.8rem', fontWeight: 800, marginBottom: '15px', background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            R.A.T.E. Intelligence
                        </h1>
                        <p style={{ fontSize: '1.15rem', color: 'var(--text-secondary)', maxWidth: '650px', margin: '0 auto 40px', lineHeight: '1.7' }}>
                            Reinforcement-based Assessment of Target Elements — A deterministic ML platform 
                            that fuses Deep RL with ANOVA statistics to identify the optimal predictive factors in any dataset.
                        </p>
                        <button className="btn-primary" style={{ fontSize: '1.1rem', padding: '16px 45px' }} onClick={() => setView('upload')}>
                            Launch Pipeline →
                        </button>
                    </div>

                    {/* Architecture Feature Cards */}
                    <div className="dashboard-grid" style={{ marginTop: '40px' }}>
                        <div className="card glass col-span-1 feature-card">
                            <div className="feature-icon">🧠</div>
                            <div className="card-title">LLM-as-Prior</div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                                Groq Llama-3 analyzes metadata to propose targets & features. Its suggestions are injected 
                                as <strong>initial weights</strong> into the RL agent — not as decisions.
                            </p>
                        </div>
                        <div className="card glass col-span-1 feature-card">
                            <div className="feature-icon">🔬</div>
                            <div className="card-title">Deterministic Execution</div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                                All ML computations are seeded (<code>random_state=42</code>). Same data in = same results out. 
                                <strong> Every single time.</strong> No statistical drift.
                            </p>
                        </div>
                        <div className="card glass col-span-1 feature-card">
                            <div className="feature-icon">🛡️</div>
                            <div className="card-title">Hallucination Gate</div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                                A strict validation barrier cross-checks every LLM suggestion against actual CSV headers. 
                                Hallucinated columns are <strong>instantly purged</strong>.
                            </p>
                        </div>
                        <div className="card glass col-span-1 feature-card">
                            <div className="feature-icon">📦</div>
                            <div className="card-title">Chunked Uploads</div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                                Files are split into 5 MB chunks and streamed to the backend. Supports datasets up to <strong>100 MB</strong> 
                                with a flat memory footprint.
                            </p>
                        </div>
                        <div className="card glass col-span-1 feature-card">
                            <div className="feature-icon">⚡</div>
                            <div className="card-title">Redis Session Cache</div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                                Duplicate analyses return instantly via Upstash Redis. Results are cached for 1 hour, 
                                then <strong>self-destruct</strong> automatically.
                            </p>
                        </div>
                        <div className="card glass col-span-1 feature-card">
                            <div className="feature-icon">♻️</div>
                            <div className="card-title">Disposable Architecture</div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                                Zero permanent storage. Raw CSVs are <strong>auto-purged</strong> after analysis. 
                                MongoDB stores only tiny metadata receipts with a 1-hour TTL.
                            </p>
                        </div>
                    </div>

                    {/* Tech Stack Footer */}
                    <div style={{ textAlign: 'center', marginTop: '50px', padding: '30px', borderTop: '1px solid var(--card-border)' }}>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>Powered By</p>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
                            {['Next.js', 'FastAPI', 'PPO (Stable-Baselines3)', 'ANOVA', 'Groq Llama-3', 'Redis', 'MongoDB'].map(tech => (
                                <span key={tech} className="tag">{tech}</span>
                            ))}
                        </div>
                    </div>
                </main>
            )}

            {/* ───────── DATA PIPELINE PAGE ───────── */}
            {view === 'upload' && (
                <main className="main-container dashboard-grid">
                    {/* Left: Upload Panel */}
                    <div className="card glass col-span-1">
                        <div className="card-title">⇪ Data Ingestion</div>
                        
                        {!llmInsight && (
                            <>
                                <div className="form-group">
                                    <label>Datasets in Pipeline</label>
                                    <input 
                                        type="number" min="1" max="10" 
                                        className="form-control" 
                                        value={numFiles} 
                                        onChange={(e) => setNumFiles(parseInt(e.target.value) || 1)} 
                                        disabled={currentFileIndex > 0}
                                    />
                                </div>

                                {currentFileIndex < numFiles ? (
                                    <form onSubmit={uploadDataset}>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', marginBottom: '15px', fontWeight: 600 }}>
                                            Sequence {currentFileIndex + 1} of {numFiles}
                                        </div>
                                        <div className="form-group">
                                            <label>Domain</label>
                                            <select name="domainSelect" className="form-control">
                                                <option value="Transportation">Transportation</option>
                                                <option value="Education">Education</option>
                                                <option value="Healthcare">Healthcare</option>
                                                <option value="Business">Business / E-Commerce</option>
                                                <option value="Finance">Finance</option>
                                                <option value="Technology">Technology</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>CSV / Excel File (Max 100 MB)</label>
                                            <input type="file" name="datasetFile" accept=".csv, .xlsx" className="form-control" required />
                                        </div>
                                        
                                        {uploadProgress > 0 && (
                                            <div className="progress-container" style={{ marginBottom: '15px' }}>
                                                <div className="progress-bar" style={{ width: `${uploadProgress}%`, transition: 'width 0.3s ease' }}></div>
                                            </div>
                                        )}
                                        
                                        <button type="submit" className="btn-primary" style={{ width: '100%' }}>
                                            Stream Dataset {currentFileIndex + 1}
                                        </button>
                                    </form>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '20px' }}>
                                        {llmLoading && (
                                            <div style={{ color: 'var(--accent-primary)' }}>
                                                <div className="radial-graphic" style={{ width: '60px', height: '60px', margin: '0 auto 15px' }}>
                                                    <div className="radial-inner" style={{ width: '25px', height: '25px' }}></div>
                                                </div>
                                                Groq AI analyzing metadata...
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                        
                        {uploadAlert && <div className={`alert ${uploadAlert.type}`}>{uploadAlert.msg}</div>}
                    </div>

                    {/* Right: Status & LLM Panel */}
                    <div className="card glass col-span-2">
                        {!llmInsight ? (
                            <>
                                <div className="card-title">📡 Pipeline Status</div>
                                
                                {/* Uploaded Datasets Summary */}
                                {multiDatasets.length > 0 ? (
                                    <div>
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>#</th>
                                                    <th>File</th>
                                                    <th>Rows</th>
                                                    <th>Columns</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {multiDatasets.map((ds, i) => (
                                                    <tr key={i}>
                                                        <td><span className="tag">{i + 1}</span></td>
                                                        <td>{ds.file_name}</td>
                                                        <td>{ds.rows?.toLocaleString()}</td>
                                                        <td>{ds.columns}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-secondary)' }}>
                                        <p style={{ fontSize: '2.5rem', marginBottom: '15px' }}>📂</p>
                                        <p>No datasets uploaded yet.</p>
                                        <p style={{ fontSize: '0.85rem', marginTop: '8px' }}>Upload your CSV files to begin the intelligence pipeline.</p>
                                    </div>
                                )}
                                
                                {/* Architecture Info */}
                                <div style={{ marginTop: 'auto', padding: '15px', background: 'rgba(0,191,165,0.05)', borderRadius: '12px', border: '1px solid rgba(0,191,165,0.1)' }}>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                                        <strong>Pipeline Flow:</strong> Chunked Upload → Metadata Extraction → Groq AI Analysis → 
                                        Strict Validation → LLM Prior Injection → PPO/ANOVA Execution → Auto-Purge
                                    </p>
                                </div>
                            </>
                        ) : (
                            /* LLM Recommendation Panel */
                            <div>
                                <div className="card-title" style={{ marginBottom: '20px' }}>✨ Groq AI Recommendations</div>
                                
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
                                    <div style={{ padding: '20px', background: 'rgba(0,191,165,0.08)', borderRadius: '12px', border: '1px solid rgba(0,191,165,0.2)' }}>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>Target Variable</p>
                                        <p style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{llmInsight.target || 'Not Set'}</p>
                                    </div>
                                    <div style={{ padding: '20px', background: 'rgba(255,152,0,0.08)', borderRadius: '12px', border: '1px solid rgba(255,152,0,0.2)' }}>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>Features Detected</p>
                                        <p style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{llmInsight.features?.length || 0}</p>
                                    </div>
                                </div>

                                <div style={{ marginBottom: '15px' }}>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Recommended Features (Priors)</p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {llmInsight.features?.map((f: string) => (
                                            <span key={f} className="tag">{f}</span>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', borderLeft: '3px solid var(--accent-primary)', marginBottom: '25px' }}>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Strategic Reasoning</p>
                                    <p style={{ color: 'var(--text-primary)', lineHeight: '1.7', fontSize: '0.95rem' }}>{llmInsight.reasoning}</p>
                                </div>
                                
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    <button className="btn-primary" onClick={() => triggerAssessment(undefined, true)}>
                                        {isAnalyzing ? '⏳ Executing...' : '🚀 Execute with LLM Priors'}
                                    </button>
                                    <button className="theme-toggle" onClick={resetPipeline}>↻ Start Fresh</button>
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            )}

            {/* ───────── ANALYSIS PAGE ───────── */}
            {view === 'analysis' && (
                <main className="main-container dashboard-grid">
                    {/* Manual Controls */}
                    <div className="card glass col-span-1">
                        <div className="card-title">⚙ Manual Assessment</div>
                        <form onSubmit={triggerAssessment}>
                            <div className="form-group">
                                <label>Target Variable</label>
                                {availableColumns.length > 0 ? (
                                    <select name="targetVar" className="form-control">
                                        {availableColumns.map(col => <option value={col} key={col}>{col}</option>)}
                                    </select>
                                ) : (
                                    <input type="text" name="targetVar" className="form-control" placeholder="Upload data first..." />
                                )}
                            </div>
                            <div className="form-group">
                                <label>Features</label>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '10px 0' }}>
                                    RL agent evaluates all {availableColumns.length ? availableColumns.length - 1 : '—'} parameters automatically.
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Algorithm</label>
                                <select name="method" className="form-control">
                                    <option value="reinforcement_learning">Deep RL (PPO + ANOVA)</option>
                                    <option value="random_forest">Random Forest (Baseline)</option>
                                </select>
                            </div>
                            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={isAnalyzing}>
                                {isAnalyzing ? '⏳ Computing...' : 'Run Assessment'}
                            </button>
                        </form>
                        {analysisAlert && <div className={`alert ${analysisAlert.type}`} style={{marginTop: '15px'}}>{analysisAlert.msg}</div>}
                        
                        {/* Source indicator */}
                        {resultSource && (
                            <div style={{ marginTop: 'auto', padding: '12px', background: 'rgba(0,191,165,0.05)', borderRadius: '10px', border: '1px solid rgba(0,191,165,0.1)' }}>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Source</p>
                                <p style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 600 }}>{resultSource}</p>
                            </div>
                        )}
                    </div>

                    {/* Results Chart */}
                    <div className="card glass col-span-2">
                        <div className="card-title">
                            Factor Importance Rankings
                            {analysisResults && <span className="tag" style={{ marginLeft: 'auto' }}>{analysisResults.method?.toUpperCase()}</span>}
                        </div>
                        <div className="chart-container" style={{ height: '350px' }}><canvas ref={rankChartRef}></canvas></div>
                        
                        {/* Results Table */}
                        {analysisResults?.rankings && (
                            <div style={{ marginTop: '15px' }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Rank</th>
                                            <th>Feature</th>
                                            <th>Score</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(analysisResults.rankings)
                                            .sort((a: any, b: any) => b[1] - a[1])
                                            .map(([feature, score]: any, i: number) => (
                                            <tr key={feature}>
                                                <td><span className="tag">#{i + 1}</span></td>
                                                <td style={{ fontWeight: i === 0 ? 700 : 400 }}>{feature}</td>
                                                <td style={{ fontFamily: 'monospace', color: 'var(--accent-primary)' }}>{typeof score === 'number' ? score.toFixed(4) : score}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </main>
            )}
        </div>
    );
}
