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
                    labels: ['Telemetry Awaiting Stream...'],
                    datasets: [{ 
                        label: 'Weight', 
                        data: [0], 
                        backgroundColor: theme === 'dark' ? '#00e5ff' : '#00e5ff',
                        borderRadius: 4,
                        maxBarThickness: 32,
                    }]
                },
                options: { 
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { display: false },
                        tooltip: { backgroundColor: '#0c0c10', titleColor: '#00e5ff', bodyColor: '#ffffff', cornerRadius: 8 }
                    },
                    scales: {
                        x: { display: false },
                        y: { grid: { display: false }, ticks: { color: theme === 'dark' ? '#f8f9fa' : '#1a1b1e', font: { weight: '600' as any }}}
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
            setUploadAlert({ msg: 'No file detected.', type: 'alert-error' });
            return;
        }

        const file = fileInput.files[0];
        if (file.size > 100 * 1024 * 1024) {
            setUploadAlert({ msg: `Oversized payload rejected (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 100MB.`, type: 'alert-error' });
            return;
        }
        
        const chunkSize = 5 * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);
        const uploadId = crypto.randomUUID(); 
        const pythonWorkerUrl = (process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://Zeo04-rate-worker.hf.space').replace(/\/$/, '');

        try {
            setUploadProgress(0);
            for (let index = 0; index < totalChunks; index++) {
                const start = index * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                const formData = new FormData();
                formData.append('upload_id', uploadId);
                formData.append('chunk_index', index.toString());
                formData.append('file', chunk);
                
                setUploadProgress(Math.round(((index + 1) / totalChunks) * 85));
                
                const res = await fetch(`${pythonWorkerUrl}/datasets/upload_chunk`, { method: 'POST', body: formData });
                if (!res.ok) throw new Error(`Link Dropped @ Chunk ${index + 1}`);
            }

            setUploadProgress(95);
            setUploadAlert({ msg: 'Finalizing secure assembly...', type: 'alert-success' });
            
            const finalizeData = new FormData();
            finalizeData.append('upload_id', uploadId);
            finalizeData.append('file_name', file.name);
            finalizeData.append('domain', domain);
            finalizeData.append('project_id', '1');
            finalizeData.append('total_chunks', totalChunks.toString());

            const finalRes = await fetch(`${pythonWorkerUrl}/datasets/finalize_upload`, { method: 'POST', body: finalizeData });
            const data = await finalRes.json();
            if (!finalRes.ok) throw new Error(data.detail);

            setUploadProgress(100);
            const updatedDatasets = [...multiDatasets, data];
            setMultiDatasets(updatedDatasets);
            const nextIndex = currentFileIndex + 1;
            setCurrentFileIndex(nextIndex);

            if (nextIndex === numFiles) {
                setUploadAlert({ msg: `Stream Synchronized. Engaging Groq LLM Intelligence...`, type: 'alert-success' });
                generateLLMInsight(updatedDatasets);
            } else {
                setUploadAlert({ msg: `Sequence ${nextIndex}/${numFiles} active. Uploading next.`, type: 'alert-success' });
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
            setUploadAlert({ msg: 'LLM Node Fault: ' + err.message, type: 'alert-error' });
        } finally {
            setLlmLoading(false);
        }
    };

    const triggerAssessment = async (e?: React.FormEvent, forceLLM: boolean = false) => {
        if (e) e.preventDefault();
        
        let targetVar: string = '', features: string[] = [], method: string = '';

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

        if (!availableColumns.includes(targetVar)) {
            const alertMsg = forceLLM ? `LLM Hallucination purge: "${targetVar}" not in schema.` : `Validation Error: Column "${targetVar}" missing.`;
            setAnalysisAlert({ msg: alertMsg, type: 'alert-error' });
            return;
        }

        if (forceLLM) setView('analysis');
        setIsAnalyzing(true);
        setAnalysisAlert({ msg: 'Executing PPO/ANOVA Pipeline...', type: 'alert-success' });
        
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
            if (!res.ok) throw new Error(data.error);

            if (chartInstances.current.rank && data.data && data.data.results_json) {
                const ranks = data.data.results_json.rankings;
                const sorted = Object.entries(ranks).sort((a: any, b: any) => b[1] - a[1]);
                
                chartInstances.current.rank.data.labels = sorted.map(e => e[0].length > 18 ? e[0].substring(0, 15) + '...' : e[0]);
                chartInstances.current.rank.data.datasets[0].data = sorted.map(e => e[1]);
                chartInstances.current.rank.update();
                setAnalysisResults(data.data.results_json);
            }
            setResultSource(data.source);
            setAnalysisAlert({ msg: `Computation Synced: ${data.source}`, type: 'alert-success' });
        } catch (error: any) {
            setAnalysisAlert({ msg: error.message, type: 'alert-error' });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const resetPipeline = () => {
        const pythonWorkerUrl = (process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://Zeo04-rate-worker.hf.space').replace(/\/$/, '');
        fetch(`${pythonWorkerUrl}/datasets/purge-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([]) }).catch(() => {});
        setLlmInsight(null); setCurrentFileIndex(0); setMultiDatasets([]); setDatasetId(null); setRunId(null); setAvailableColumns([]);
        setUploadAlert(null); setAnalysisAlert(null); setUploadProgress(0); setAnalysisResults(null); setResultSource('');
    };

    return (
        <div style={{ paddingBottom: '80px' }}>
            {/* ── Navbar ── */}
            <nav className="navbar glass animate-slide-up">
                <div className="logo-container">
                    <div className="logo-icon">R</div>
                    R.A.T.E. <span style={{ color: 'var(--accent)', fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', marginBottom: '8px' }}>CORE</span>
                </div>
                <ul className="nav-links">
                    <li className={view === 'landing' ? 'active' : ''} onClick={() => setView('landing')}>Home</li>
                    <li className={view === 'upload' ? 'active' : ''} onClick={() => setView('upload')}>Pipeline</li>
                    <li className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}>Analysis</li>
                </ul>
                <div className="nav-actions">
                    <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                        {theme === 'light' ? 'Studio Dark' : 'Paper White'}
                    </button>
                </div>
            </nav>

            {/* ── LANDING ── */}
            {view === 'landing' && (
                <main className="main-container animate-slide-up" style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <div style={{ textAlign: 'center', padding: '100px 0 60px' }}>
                        <div className="radial-graphic" style={{ margin: '0 auto 40px' }}>
                            <div className="radial-ring"></div>
                            <div className="radial-inner" style={{ background: 'var(--text-main)', boxShadow: '0 0 30px var(--accent-dim)' }}></div>
                        </div>
                        <h1 style={{ fontSize: '3.5rem', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: '0.9', marginBottom: '24px' }}>
                            Precision Analytical <br /> Node.
                        </h1>
                        <p style={{ color: 'var(--text-dim)', fontSize: '1.2rem', fontWeight: 500, maxWidth: '600px', margin: '0 auto 48px', lineHeight: '1.6' }}>
                            The Reinforcement Analytical Target Engine. <br />
                            Deterministic feature importance for mission-critical datasets.
                        </p>
                        <button className="btn-primary" onClick={() => setView('upload')}>
                            Connect Pipeline <span style={{ opacity: 0.4 }}>→</span>
                        </button>
                    </div>

                    <div className="dashboard-grid">
                        <div className="card">
                            <div className="card-title">Machine Intelligence</div>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: '1.6' }}>
                                GROQ Llama-3-70B node processes metadata to generate structural priors for the RL agent.
                            </p>
                        </div>
                        <div className="card">
                            <div className="card-title">Deterministic Gate</div>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: '1.6' }}>
                                Seeding strategy fixed to <code>#42</code> ensuring mathematical parity across every single deployment.
                            </p>
                        </div>
                        <div className="card">
                            <div className="card-title">Ephemeral Cluster</div>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: '1.6' }}>
                                Auto-purge protocol deletes raw CSV payloads post-analysis. 0% data retention for maximum privacy.
                            </p>
                        </div>
                    </div>
                </main>
            )}

            {/* ── PIPELINE ── */}
            {view === 'upload' && (
                <main className="main-container dashboard-grid animate-slide-up" style={{ maxWidth: '1300px', margin: '0 auto' }}>
                    <div className="card col-span-1" style={{ alignSelf: 'start' }}>
                        <div className="card-title">Ingestion Control</div>
                        
                        {!llmInsight && (
                            <form onSubmit={uploadDataset}>
                                <div className="form-group">
                                    <label>Cluster Size (Datasets)</label>
                                    <input type="number" className="form-control" value={numFiles} onChange={e => setNumFiles(parseInt(e.target.value) || 1)} disabled={currentFileIndex > 0}/>
                                </div>
                                {currentFileIndex < numFiles ? (
                                    <>
                                        <div className="form-group">
                                            <label>Domain</label>
                                            <select name="domainSelect" className="form-control">
                                                <option>Transportation</option><option>Healthcare</option><option>Education</option><option>Business</option><option>Finance</option><option>Other</option>
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: '32px' }}>
                                            <label>Payload (CSV)</label>
                                            <input type="file" name="datasetFile" accept=".csv" className="form-control" required style={{ paddingTop: '10px' }} />
                                        </div>
                                        {uploadProgress > 0 && (
                                            <div className="progress-container" style={{ marginBottom: '20px' }}>
                                                <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
                                            </div>
                                        )}
                                        <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                                            Inject Sequence {currentFileIndex + 1}
                                        </button>
                                    </>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '40px 0' }}>
                                        {llmLoading && <div style={{ fontWeight: 800, color: 'var(--accent)', letterSpacing: '2px' }}>BRAIN LINK ACTIVE...</div>}
                                    </div>
                                )}
                            </form>
                        )}
                        {uploadAlert && <div className={`alert ${uploadAlert.type}`} style={{ marginTop: '20px' }}>{uploadAlert.msg}</div>}
                    </div>

                    <div className="card col-span-2">
                        <div className="card-title">Status Telemetry</div>
                        
                        {!llmInsight ? (
                            <div className="table-wrapper">
                                <table className="data-table">
                                    <thead>
                                        <tr><th>ID</th><th>Source Name</th><th>Rows</th><th>Dim</th></tr>
                                    </thead>
                                    <tbody>
                                        {multiDatasets.length > 0 ? multiDatasets.map((ds, i) => (
                                            <tr key={i}>
                                                <td><span className="metric-pill">{i + 1}</span></td>
                                                <td style={{ fontWeight: 700 }}>{ds.file_name}</td>
                                                <td>{ds.rows?.toLocaleString()}</td>
                                                <td style={{ color: 'var(--accent)', fontWeight: 800 }}>{ds.columns}</td>
                                            </tr>
                                        )) : (
                                            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '60px 0' }}>Awaiting Data Stream Inject...</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="animate-slide-up">
                                <h1 style={{ fontSize: '2rem', fontWeight: 900, marginBottom: '24px', letterSpacing: '-0.03em' }}>Intelligence Report</h1>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
                                    <div className="card" style={{ background: 'var(--bg-offset)', padding: '20px' }}>
                                        <label style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Primary Target</label>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent)' }}>{llmInsight.target}</div>
                                    </div>
                                    <div className="card" style={{ background: 'var(--bg-offset)', padding: '20px' }}>
                                        <label style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Feature Set Size</label>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{llmInsight.features?.length}</div>
                                    </div>
                                </div>
                                <div style={{ marginBottom: '32px' }}>
                                    <label style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '12px', display: 'block' }}>Analytical Reasoning</label>
                                    <div style={{ lineHeight: '1.7', color: 'var(--text-main)', fontSize: '1rem', fontWeight: 500 }}>{llmInsight.reasoning}</div>
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button className="btn-primary" onClick={() => triggerAssessment(undefined, true)}>Connect Target Node</button>
                                    <button className="theme-toggle" style={{ height: '48px' }} onClick={resetPipeline}>Disconnect Pipeline</button>
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            )}

            {/* ── ANALYSIS ── */}
            {view === 'analysis' && (
                <main className="main-container dashboard-grid animate-slide-up" style={{ maxWidth: '1300px', margin: '0 auto' }}>
                    <div className="card col-span-1" style={{ alignSelf: 'start' }}>
                        <div className="card-title">Manual Overrides</div>
                        <form onSubmit={triggerAssessment}>
                            <div className="form-group">
                                <label>Target Parameter</label>
                                <select name="targetVar" className="form-control">
                                    {availableColumns.map(col => <option value={col} key={col}>{col}</option>)}
                                </select>
                            </div>
                            <div className="form-group" style={{ marginBottom: '32px' }}>
                                <label>Heuristics</label>
                                <select name="method" className="form-control">
                                    <option value="reinforcement_learning">Deep RL Optimizer</option>
                                    <option value="random_forest">Baseline Check</option>
                                </select>
                            </div>
                            <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={isAnalyzing}>
                                {isAnalyzing ? 'Processing Trace...' : 'Initiate Scan'}
                            </button>
                        </form>
                        {analysisAlert && <div className={`alert ${analysisAlert.type}`} style={{ marginTop: '20px' }}>{analysisAlert.msg}</div>}
                        {resultSource && (
                            <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Hardware Load Source</div>
                                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--accent)' }}>{resultSource}</div>
                            </div>
                        )}
                    </div>

                    <div className="card col-span-2">
                        <div className="card-title">Importance Visualization</div>
                        <div className="chart-container" style={{ height: '380px', marginTop: '20px' }}><canvas ref={rankChartRef}></canvas></div>
                        {analysisResults && (
                            <div className="table-wrapper" style={{ marginTop: '32px' }}>
                                <table className="data-table">
                                    <thead><tr><th>#</th><th>Parameter Node</th><th>Weight Score</th></tr></thead>
                                    <tbody>
                                        {Object.entries(analysisResults.rankings).sort((a: any, b: any) => b[1] - a[1]).map(([f, s]: any, i) => (
                                            <tr key={i}>
                                                <td><span className="metric-pill">#{i + 1}</span></td>
                                                <td style={{ fontWeight: i === 0 ? 900 : 500 }}>{f}</td>
                                                <td style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--accent)' }}>{(s as number).toFixed(5)}</td>
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
