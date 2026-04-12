'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function Home() {
    const [view, setView] = useState('upload');
    const [theme, setTheme] = useState('light');
    
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
                    labels: ['Run analysis first...'],
                    datasets: [{ label: 'Factor Importance Score', data: [0], backgroundColor: '#ff9800' }]
                },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
            });
        }
    }, [view, theme]); // Added theme to re-render charts accurately

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
        const chunkSize = 5 * 1024 * 1024; // 5MB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        const uploadId = crypto.randomUUID(); 
        const pythonWorkerUrl = process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://fatty04-rate.hf.space';

        try {
            // Step 1: Upload sequentially in chunks
            for (let index = 0; index < totalChunks; index++) {
                const start = index * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                const formData = new FormData();
                formData.append('upload_id', uploadId);
                formData.append('chunk_index', index.toString());
                formData.append('file', chunk);
                
                setUploadAlert({ msg: `Uploading chunk ${index + 1} of ${totalChunks} safely...`, type: 'alert-success' });
                
                const res = await fetch(`${pythonWorkerUrl}/datasets/upload_chunk`, {
                    method: 'POST',
                    body: formData
                });
                
                if (!res.ok) throw new Error(`Chunk ${index + 1} failed to safely transfer.`);
            }

            // Step 2: Finalize and process
            setUploadAlert({ msg: 'All chunks uploaded. Assembling and processing data remotely...', type: 'alert-success' });
            
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

            // Add to multi-dataset stash
            const updatedDatasets = [...multiDatasets, data];
            setMultiDatasets(updatedDatasets);
            const nextIndex = currentFileIndex + 1;
            setCurrentFileIndex(nextIndex);

            if (nextIndex === numFiles) {
                setUploadAlert({ msg: `All datasets uploaded! Connecting to Groq AI for systemic insights...`, type: 'alert-success' });
                generateLLMInsight(updatedDatasets);
            } else {
                setUploadAlert({ msg: `Dataset ${nextIndex} uploaded successfully. Ready for the next one.`, type: 'alert-success' });
            }

            // Sync legacy state context if needed
            setDatasetId(data.dataset_id);
            setRunId(data.dataset_id); 
            
        } catch (error: any) {
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
            
            // Pool all unique metadata columns across multi-csv models for the Analytics Dashboard to digest
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

        // 3. Strict Front-End Validation Layer
        if (!availableColumns.includes(targetVar)) {
            const alertMsg = forceLLM 
                ? `LLM Hallucination! Target "${targetVar}" doesn't exist. Fix in manual tab.`
                : `Strict Validation Failed: Target "${targetVar}" does not exist.`;
            
            if (forceLLM) setUploadAlert({ msg: alertMsg, type: 'alert-error' });
            else setAnalysisAlert({ msg: alertMsg, type: 'alert-error' });
            return;
        }

        if (forceLLM) setView('analysis');
        setAnalysisAlert({ msg: 'Routing strictly validated parameters to Vercel/Python backend...', type: 'alert-success' });
        
        try {
            const res = await fetch('/api/rate-metrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    datasetId: runId || 1, 
                    targetVariable: targetVar, 
                    features: features, 
                    method: method,
                    llmPriors: llmInsight?.features || null // Send priors explicitly to the backend
                })
            });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Serverless failure');

            // Draw Chart 
            if (chartInstances.current.rank && data.data && data.data.results_json) {
                const ranks = data.data.results_json.rankings;
                chartInstances.current.rank.data.labels = Object.keys(ranks);
                chartInstances.current.rank.data.datasets[0].data = Object.values(ranks);
                chartInstances.current.rank.update();
            }

            setAnalysisAlert({ msg: `Success! Computed via: ${data.source}`, type: 'alert-success' });
            
        } catch (error: any) {
            setAnalysisAlert({ msg: error.message, type: 'alert-error' });
        }
    };

    return (
        <div style={{ paddingBottom: '50px' }}>
            <nav className="navbar glass">
                <div className="logo-container">
                    <div className="logo-icon">R</div>
                    R.A.T.E. System
                </div>
                <ul className="nav-links">
                    <li className={view === 'upload' ? 'active' : ''} onClick={() => setView('upload')}>⇪ DATA PIPELINE</li>
                    <li className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}>📊 RUN ANALYSIS</li>
                </ul>
                <div className="nav-actions">
                    <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                        {theme === 'light' ? 'Dark Mode ☾' : 'Light Mode ☀'}
                    </button>
                </div>
            </nav>

            {view === 'upload' && (
                <main className="main-container dashboard-grid">
                     <div className="card glass col-span-2">
                        <div className="card-title">Multi-Dataset Pipeline Setup</div>
                        {!llmInsight ? (
                            <>
                                <div className="form-group" style={{ maxWidth: '300px' }}>
                                    <label>Total CSV Files in Pipeline</label>
                                    <input 
                                        type="number" min="1" max="10" 
                                        className="form-control" 
                                        value={numFiles} 
                                        onChange={(e) => setNumFiles(parseInt(e.target.value) || 1)} 
                                        disabled={currentFileIndex > 0}
                                    />
                                </div>

                                {currentFileIndex < numFiles ? (
                                    <form onSubmit={uploadDataset} style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
                                        <p style={{ fontSize: '0.9rem', color: '#00bfa5', marginBottom: '10px' }}>Upload Sequence: {currentFileIndex + 1} of {numFiles}</p>
                                        <div className="form-group">
                                            <label>Dataset Domain</label>
                                            <select name="domainSelect" className="form-control">
                                                <option value="Transportation">Transportation</option>
                                                <option value="Education">Education</option>
                                                <option value="Healthcare">Healthcare</option>
                                                <option value="Business">Business / E-Commerce</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Target CSV/Excel file</label>
                                            <input type="file" name="datasetFile" accept=".csv, .xlsx" className="form-control" required />
                                        </div>
                                        <button type="submit" className="btn-primary">Stream Sequence {currentFileIndex + 1}</button>
                                    </form>
                                ) : (
                                    <div style={{ marginTop: '30px', textAlign: 'center' }}>
                                        {llmLoading ? (
                                            <div style={{ color: '#00bfa5', padding: '20px' }}>🧠 Groq AI is cross-referencing CSV metadata...</div>
                                        ) : null}
                                    </div>
                                )}
                                {uploadAlert && <div className={`alert ${uploadAlert.type}`} style={{marginTop: '20px'}}>{uploadAlert.msg}</div>}
                            </>
                        ) : (
                           <div className="llm-insight-container" style={{ marginTop: '20px', padding: '20px', background: 'rgba(0, 191, 165, 0.05)', borderRadius: '10px', border: '1px solid rgba(0, 191, 165, 0.2)' }}>
                                <h3 style={{ color: '#00bfa5', marginBottom: '15px' }}>✨ Groq Structured Priority Recommendations</h3>
                                <p style={{ lineHeight: '1.6', marginBottom: '15px' }}><strong>Target Selection:</strong> <span className="tag">{llmInsight.target || 'Not Set'}</span></p>
                                <p style={{ lineHeight: '1.6', marginBottom: '15px' }}><strong>Recommended Features (Priors):</strong> <span style={{ color: 'var(--text-secondary)' }}>{llmInsight.features?.join(', ') || 'Auto'}</span></p>
                                <p style={{ lineHeight: '1.6', marginBottom: '25px', color: 'var(--text-secondary)' }}><strong>Strategic Reasoning:</strong> {llmInsight.reasoning}</p>
                                
                                <div style={{ padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', borderLeft: '3px solid #ff9800' }}>
                                    <p style={{ fontSize: '1.1rem', marginBottom: '15px' }}><strong>Proceed with LLM Pipeline Guidance?</strong></p>
                                    <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                                        <button className="btn-primary" onClick={() => triggerAssessment(undefined, true)}>
                                            Execute Recommended Assessment
                                        </button>
                                    </div>
                                </div>
                                <button className="theme-toggle" style={{ marginTop: '20px' }} onClick={() => { setLlmInsight(null); setCurrentFileIndex(0); setMultiDatasets([]); }}>Start Fresh Pipeline</button>
                           </div>
                        )}
                    </div>
                </main>
            )}

            {view === 'analysis' && (
                <main className="main-container dashboard-grid">
                    <div className="card glass col-span-1">
                        <div className="card-title">Factor Assessment (Serverless API Routing)</div>
                        <form onSubmit={triggerAssessment}>
                            <div className="form-group">
                                <label>Target Variable Parameter</label>
                                {availableColumns.length > 0 ? (
                                    <select name="targetVar" className="form-control">
                                        {availableColumns.map(col => <option value={col} key={col}>{col}</option>)}
                                    </select>
                                ) : (
                                    <input type="text" name="targetVar" className="form-control" placeholder="Please upload data first..." />
                                )}
                            </div>
                            <div className="form-group" style={{ paddingBottom: '10px' }}>
                                <label>Features Evaluated</label>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    R.A.T.E. Reinforcement Learning actively scans all {availableColumns.length ? availableColumns.length - 1 : 'available'} metadata parameters.
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Assessment Core Algorithm</label>
                                <select name="method" className="form-control">
                                    <option value="reinforcement_learning">RATE Deep RL (Fused with ANOVA Metadata)</option>
                                    <option value="random_forest">Baseline Check (Random Forest)</option>
                                </select>
                            </div>
                            <button type="submit" className="btn-primary">Trigger Serverless Assessment</button>
                        </form>
                        {analysisAlert && <div className={`alert ${analysisAlert.type}`} style={{marginTop: '20px'}}>{analysisAlert.msg}</div>}
                    </div>

                    <div className="card glass col-span-2">
                        <div className="card-title">Ranking Results & Evaluation</div>
                        <div className="chart-container"><canvas ref={rankChartRef}></canvas></div>
                    </div>
                </main>
            )}
        </div>
    );
}
