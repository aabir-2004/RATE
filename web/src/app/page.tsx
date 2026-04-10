'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function Home() {
    const [view, setView] = useState('overview');
    const [theme, setTheme] = useState('light');
    
    // API States
    const [datasetId, setDatasetId] = useState<number | null>(null);
    const [runId, setRunId] = useState<number | null>(null);
    const [availableColumns, setAvailableColumns] = useState<string[]>([]);
    
    // UI Feedback
    const [uploadAlert, setUploadAlert] = useState<{msg: string, type: string} | null>(null);
    const [analysisAlert, setAnalysisAlert] = useState<{msg: string, type: string} | null>(null);
    
    // Chart References
    const lineChartRef = useRef<HTMLCanvasElement>(null);
    const barChartRef = useRef<HTMLCanvasElement>(null);
    const rankChartRef = useRef<HTMLCanvasElement>(null);
    
    const chartInstances = useRef<{line: any, bar: any, rank: any}>({ line: null, bar: null, rank: null });

    useEffect(() => {
        document.body.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        if (view === 'overview' && lineChartRef.current && barChartRef.current) {
            if (chartInstances.current.line) chartInstances.current.line.destroy();
            if (chartInstances.current.bar) chartInstances.current.bar.destroy();
            
            chartInstances.current.line = new Chart(lineChartRef.current, {
                type: 'line',
                data: {
                    labels: ['Waiting for tasks...'],
                    datasets: [{ label: 'System Load Metrics', data: [0], borderColor: '#00bfa5', backgroundColor: 'rgba(0, 191, 165, 0.1)', tension: 0.4, fill: true }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });

            chartInstances.current.bar = new Chart(barChartRef.current, {
                type: 'bar',
                data: {
                    labels: ['Waiting for uploads...'],
                    datasets: [{ label: 'Dataset Streams', data: [0], backgroundColor: '#00897b', borderRadius: 5 }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
        
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

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('project_id', '1');
        formData.append('domain', domain);

        setUploadAlert({ msg: 'Uploading safely to Python worker...', type: 'alert-success' });
        try {
            const pythonWorkerUrl = process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://fatty04-rate.hf.space';
            const res = await fetch(`${pythonWorkerUrl}/datasets/`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.detail || 'Upload failed');

            setDatasetId(data.dataset_id);
            setRunId(data.dataset_id); 
            if (data.columns_list) setAvailableColumns(data.columns_list);
            
            setUploadAlert({ msg: `Successfully uploaded Dataset #${data.dataset_id}! Columns initialized.`, type: 'alert-success' });
        } catch (error: any) {
            setUploadAlert({ msg: error.message, type: 'alert-error' });
        }
    };

    const triggerAssessment = async (e: React.FormEvent) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const targetVar = (form.elements.namedItem('targetVar') as HTMLInputElement | HTMLSelectElement).value;
        const features = availableColumns.length > 0 ? availableColumns.filter(c => c !== targetVar) : ['Auto_Detect'];
        const method = (form.elements.namedItem('method') as HTMLSelectElement).value;

        setAnalysisAlert({ msg: 'Routing algorithm to Vercel/Python backend...', type: 'alert-success' });
        
        try {
            const res = await fetch('/api/rate-metrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ datasetId: runId || 1, targetVariable: targetVar, features, method })
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
                    <li className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>⊞ OVERVIEW</li>
                    <li className={view === 'upload' ? 'active' : ''} onClick={() => setView('upload')}>⇪ UPLOAD DATA</li>
                    <li className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}>📊 ANALYSIS</li>
                </ul>
                <div className="nav-actions">
                    <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                        {theme === 'light' ? 'Dark Mode ☾' : 'Light Mode ☀'}
                    </button>
                </div>
            </nav>

            {view === 'overview' && (
                <main className="main-container dashboard-grid">
                    <div className="card glass col-span-1" style={{ alignItems: 'center', justifyContent: 'center' }}>
                        <div className="radial-graphic"><div className="radial-inner"></div></div>
                        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '20px' }}>RL & ANOVA Intelligence Core</p>
                        <button className="btn-primary" onClick={() => setView('upload')}>GET STARTED</button>
                    </div>

                    <div className="card glass col-span-2">
                        <div className="card-title">Model Compute Load <span className="tag" style={{ marginLeft: 'auto' }}>Live Telemetry</span></div>
                        <div className="chart-container"><canvas ref={lineChartRef}></canvas></div>
                    </div>

                    <div className="card glass col-span-1">
                        <div className="card-title">⍆ Dataset Intake Stream</div>
                        <div className="chart-container" style={{ height: '180px' }}><canvas ref={barChartRef}></canvas></div>
                    </div>

                    <div className="card glass col-span-1">
                        <div className="card-title">⚙ Pipeline Execution Status</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '15px' }}>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}><span>System Load</span> <span>0%</span></div>
                                <div className="progress-container"><div className="progress-bar" style={{ width: '0%' }}></div></div>
                            </div>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}><span>RL Optimization</span> <span>0%</span></div>
                                <div className="progress-container"><div className="progress-bar" style={{ width: '0%' }}></div></div>
                            </div>
                        </div>
                    </div>
                </main>
            )}

            {view === 'upload' && (
                <main className="main-container dashboard-grid">
                     <div className="card glass col-span-1">
                        <div className="card-title">Upload Core Dataset</div>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Note: Large files transfer natively to the heavy backend Python environment to bypass Vercel 250MB cloud limits.</p>
                        <form onSubmit={uploadDataset}>
                            <div className="form-group">
                                <label>Dataset Domain</label>
                                <select name="domainSelect" className="form-control">
                                    <option value="Transportation">Transportation</option>
                                    <option value="Education">Education</option>
                                    <option value="Healthcare">Healthcare</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Target CSV/Excel file</label>
                                <input type="file" name="datasetFile" accept=".csv, .xlsx" className="form-control" required />
                            </div>
                            <button type="submit" className="btn-primary">Upload Data</button>
                        </form>
                        {uploadAlert && <div className={`alert ${uploadAlert.type}`} style={{marginTop: '20px'}}>{uploadAlert.msg}</div>}
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
