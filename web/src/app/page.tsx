'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function Home() {
    const [view, setView] = useState('overview');
    const [theme, setTheme] = useState('dark');
    
    // Core Pipeline Stages
    const [stage, setStage] = useState<'idle' | 'upload' | 'validation' | 'llm' | 'anova' | 'rl' | 'finished'>('idle');
    const [logs, setLogs] = useState<{t: string, m: string, s: 'success' | 'warn' | 'info'}[]>([]);

    // API & Data States
    const [datasetId, setDatasetId] = useState<number | null>(null);
    const [availableColumns, setAvailableColumns] = useState<string[]>([]);
    const [numFiles, setNumFiles] = useState<number>(1);
    const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
    const [multiDatasets, setMultiDatasets] = useState<any[]>([]);
    const [llmInsight, setLlmInsight] = useState<any>(null);
    const [llmLoading, setLlmLoading] = useState<boolean>(false);
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
    const [analysisResults, setAnalysisResults] = useState<any>(null);
    const [resultSource, setResultSource] = useState<string>('');
    
    const rankChartRef = useRef<HTMLCanvasElement>(null);
    const chartInstances = useRef<{rank: any}>({ rank: null });

    const addLog = (m: string, s: 'success' | 'warn' | 'info' = 'info') => {
        const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev.slice(-15), { t, m, s }]);
    };

    useEffect(() => {
        addLog("R.A.T.E. Elite v3.0 initialized successfully.", "success");
    }, []);

    useEffect(() => {
        if (view === 'results' && rankChartRef.current && analysisResults) {
             if (chartInstances.current.rank) chartInstances.current.rank.destroy();
             
             const ranks = analysisResults.rankings;
             const sortedEntries = Object.entries(ranks).sort((a: any, b: any) => b[1] - a[1]);

             chartInstances.current.rank = new Chart(rankChartRef.current, {
                type: 'bar',
                data: {
                    labels: sortedEntries.map(e => e[0]),
                    datasets: [{ 
                        label: 'Factor Importance', 
                        data: sortedEntries.map(e => e[1]), 
                        backgroundColor: '#00bfa5',
                        borderRadius: 4
                    }]
                },
                options: { 
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { 
                        x: { grid: { color: 'rgba(255,255,255,0.05)' } },
                        y: { ticks: { color: '#f5f6fa' } }
                    }
                }
            });
        }
    }, [view, analysisResults]);

    const uploadDataset = async (e: React.FormEvent) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const fileInput = form.elements.namedItem('datasetFile') as HTMLInputElement;
        if (!fileInput.files || fileInput.files.length === 0) return;

        const file = fileInput.files[0];
        const pythonWorkerUrl = (process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://Zeo04-rate-worker.hf.space').replace(/\/$/, '');
        
        setStage('upload');
        addLog(`Initiating chunked stream for: ${file.name}`, "info");

        try {
            const chunkSize = 5 * 1024 * 1024;
            const totalChunks = Math.ceil(file.size / chunkSize);
            const uploadId = crypto.randomUUID(); 

            for (let index = 0; index < totalChunks; index++) {
                const chunk = file.slice(index * chunkSize, (index + 1) * chunkSize);
                const formData = new FormData();
                formData.append('upload_id', uploadId);
                formData.append('chunk_index', index.toString());
                formData.append('file', chunk);
                
                await fetch(`${pythonWorkerUrl}/datasets/upload_chunk`, { method: 'POST', body: formData });
            }

            const finalizeData = new FormData();
            finalizeData.append('upload_id', uploadId);
            finalizeData.append('file_name', file.name);
            finalizeData.append('total_chunks', totalChunks.toString());
            finalizeData.append('domain', 'Business');
            finalizeData.append('project_id', '1');

            const finalRes = await fetch(`${pythonWorkerUrl}/datasets/finalize_upload`, { method: 'POST', body: finalizeData });
            const data = await finalRes.json();
            
            const updatedDatasets = [...multiDatasets, data];
            setMultiDatasets(updatedDatasets);
            setDatasetId(data.dataset_id);
            addLog(`Dataset ${currentFileIndex + 1} locked and loaded.`, "success");

            if (currentFileIndex + 1 === numFiles) {
                setStage('llm');
                addLog(`All sequence uploads complete. Invoking Groq LLM Structuring...`, "info");
                generateLLMInsight(updatedDatasets);
            } else {
                setCurrentFileIndex(prev => prev + 1);
                setStage('idle');
            }
        } catch (err: any) {
            addLog(`Stream failure: ${err.message}`, "warn");
            setStage('idle');
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
            setLlmInsight(d.insight);
            let allCols: string[] = [];
            datasetsData.forEach(m => allCols.push(...m.columns_list));
            setAvailableColumns(Array.from(new Set(allCols))); 
            addLog(`Groq AI recommendation received: Target = ${d.insight.target}`, "success");
            setStage('idle');
        } catch (err) {
            addLog("LLM Analysis failed to structuralize metadata.", "warn");
        } finally {
            setLlmLoading(false);
        }
    };

    const triggerAssessment = async (forceLLM: boolean = false) => {
        if (!datasetId || !llmInsight) return;
        
        setIsAnalyzing(true);
        setStage('validation');
        addLog(`Enforcing strict schema validation for ${llmInsight.target}...`, "info");

        try {
            const res = await fetch('/api/rate-metrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    datasetId: datasetId, 
                    targetVariable: llmInsight.target, 
                    features: llmInsight.features, 
                    method: 'reinforcement_learning'
                })
            });
            const data = await res.json();
            setAnalysisResults(data.data.results_json);
            setResultSource(data.source);
            setStage('finished');
            addLog(`Pipeline complete. RL Agent converged with seed 42.`, "success");
            setView('results');
        } catch (err) {
            addLog("Assessment routing failed.", "warn");
            setStage('idle');
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="app-layout">
            {/* ───────── Sidebar ───────── */}
            <aside className="sidebar">
                <div className="logo">
                    <div className="logo-icon">R</div>
                    R.A.T.E. System
                </div>
                <div className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview</div>
                <div className={`nav-item ${view === 'dataset' ? 'active' : ''}`} onClick={() => setView('dataset')}>Dataset Stream</div>
                <div className={`nav-item ${view === 'results' ? 'active' : ''}`} onClick={() => setView('results')}>Pipeline Results</div>
                <div className={`nav-item`} onClick={() => setLogs([])}>Clear Console</div>
            </aside>

            {/* ───────── Main Stage ───────── */}
            <main className="main-stage">
                <div className="header-bar">
                    <div className="breadcrumb">
                        <span>Projects</span> / <span>RATE v1.0</span> / <strong>{multiDatasets[0]?.file_name || 'Idle'}</strong>
                    </div>
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <span className="tag-elite">{stage.toUpperCase()}</span>
                        <button className="btn-run" onClick={() => triggerAssessment(true)} disabled={!llmInsight || isAnalyzing}>Run Pipeline</button>
                    </div>
                </div>

                {view === 'overview' && (
                  <>
                    <section className="node-stage">
                        <div className="node-group">
                            <div className={`node ${datasetId ? 'active' : ''}`}>
                                <div className="node-title">📁 Dataset</div>
                                <div className="node-status">{multiDatasets[0]?.rows?.toLocaleString() || '0'} Rows</div>
                            </div>
                            <div className={`node ${stage === 'validation' ? 'processing' : (stage === 'finished' ? 'active' : '')}`}>
                                <div className="node-title">🛡️ Validation</div>
                                <div className="node-status"><div className={`status-dot ${stage === 'validation' ? 'waiting' : (stage === 'finished' ? 'active' : '')}`}></div> {stage === 'validation' ? 'Syncing' : 'Idle'}</div>
                            </div>
                            <div className={`node ${llmInsight ? 'active' : ''}`}>
                                <div className="node-title">🧠 Structuring</div>
                                <div className="node-status">{llmInsight ? 'Groq Complete' : 'Awaiting'}</div>
                            </div>
                            <div className={`node ${stage === 'finished' ? 'active' : (stage === 'rl' ? 'processing' : '')} last`}>
                                <div className="node-title">🏆 Results</div>
                                <div className="node-status">{stage === 'finished' ? 'Ready' : 'Idle'}</div>
                            </div>
                        </div>
                        <div className="rl-ppo-stage">
                            <div className="node-title">🧬 RL PPO Agent</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--teal)' }}>Seed: 42 Locked</div>
                        </div>
                    </section>

                    <section className="log-stage glass">
                        <div className="panel-section-title">System Execution Logs</div>
                        <div className="log-list">
                            {logs.map((l, i) => (
                                <div key={i} className="log-entry">
                                    <div className="log-dot" style={{ backgroundColor: l.s === 'success' ? '#00bfa5' : (l.s === 'warn' ? '#ff9800' : '#2196f3') }}></div>
                                    <span className="log-time">{l.t}</span>
                                    <span className="log-text">{l.m}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                  </>
                )}

                {view === 'dataset' && (
                    <section className="card glass">
                        <div className="card-title">Initiate Sequence Stream</div>
                        <form onSubmit={uploadDataset} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <div className="form-group">
                                <label>Pipeline Batch Count</label>
                                <input className="form-control" type="number" min="1" value={numFiles} onChange={(e) => setNumFiles(parseInt(e.target.value))} />
                            </div>
                            <div className="form-group">
                                <label>Select CSV Source ({currentFileIndex + 1}/{numFiles})</label>
                                <input className="form-control" type="file" name="datasetFile" accept=".csv" />
                            </div>
                            <button type="submit" className="btn-run" style={{ width: '100%' }}>Inject into Pipeline</button>
                        </form>
                    </section>
                )}

                {view === 'results' && (
                    <section className="card glass" style={{ flex: 1 }}>
                        <div className="card-title">RL Ranking Convergence Output <span className="tag-elite" style={{ marginLeft: '10px' }}>{resultSource}</span></div>
                        <div style={{ height: '400px' }}><canvas ref={rankChartRef}></canvas></div>
                    </section>
                )}
            </main>

            {/* ───────── Context Panel ───────── */}
            <aside className="context-panel">
                <section>
                    <div className="panel-section-title">Active Metadata</div>
                    <div className="breadcrumb">Rows: {multiDatasets[0]?.rows || 'N/A'}</div>
                    <div className="breadcrumb">Features: {availableColumns.length}</div>
                </section>

                <section>
                    <div className="panel-section-title">JSON Pipeline Structured Schema</div>
                    <div className="schema-box">
                        {llmInsight ? JSON.stringify(llmInsight, null, 2) : '// Awaiting LLM structuring...'}
                    </div>
                </section>

                <section>
                    <div className="panel-section-title">Sample Preview</div>
                    {multiDatasets[0] ? (
                        <table className="data-preview-mini">
                            <thead><tr><th>#</th><th>Col</th></tr></thead>
                            <tbody>
                                {multiDatasets[0].columns_list?.slice(0, 5).map((c: string, i: number) => (
                                    <tr key={i}><td>{i}</td><td>{c}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    ) : 'No stream active.'}
                </section>
            </aside>
        </div>
    );
}
