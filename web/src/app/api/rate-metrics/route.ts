import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { redis } from '@/lib/redis';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { datasetId, targetVariable, features, method, llmPriors } = body;

    if (!datasetId || !targetVariable) {
      return NextResponse.json({ error: 'Missing required parameters.' }, { status: 400 });
    }

    // ── 1. CHECK REDIS SESSION CACHE ─────────────────────────────────
    // Redis is the primary session memory. If a user re-runs the same
    // analysis within the session window, we return instantly.
    const cacheKey = `rate:eval:${datasetId}:${method}:${targetVariable}`;
    
    let cachedResult = null;
    try {
      const rawData = await redis.get(cacheKey);
      if (rawData) {
          cachedResult = JSON.parse(rawData);
      }
    } catch (redisError) {
      console.warn('⚠️ Redis Cache Error (Proceeding without cache):', redisError);
    }

    if (cachedResult) {
      console.log('✅ Session Cache Hit! Bypassing heavy Python computation.');
      return NextResponse.json({ 
        source: 'Redis Session Cache (Instant)', 
        data: cachedResult 
      });
    }

    console.log('❌ Cache Miss. Routing to Python Worker...');

    // ── 2. ROUTE TO FASTAPI (PYTHON ML WORKER) ──────────────────────
    const pythonWorkerUrl = (process.env.PYTHON_WORKER_URL || process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://zeo04-rate-worker.hf.space').replace(/\/$/, '');
    
    // Step A: Run Preprocessing
    const preprocessRes = await fetch(`${pythonWorkerUrl}/preprocessing/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset_id: datasetId,
        options: {
          handle_missing: "mean",
          normalize: false,
          encode_categorical: true
        }
      })
    });
    if (!preprocessRes.ok) {
        const errData = await preprocessRes.text();
        console.error('Preprocessing Error:', errData);
        throw new Error('Worker failed during preprocessing phase.');
    }
    const prepData = await preprocessRes.json();
    const activeRunId = prepData.run_id;

    // Step B: Trigger Selection
    const selectRes = await fetch(`${pythonWorkerUrl}/preprocessing/feature-selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_id: activeRunId,
        target_variable: targetVariable,
        selected_features: features
      })
    });
    
    if (!selectRes.ok) throw new Error('Worker failed during selection layer.');
    const selectionData = await selectRes.json();

    // Step C: Trigger Heavy Assessment (PPO/ANOVA)
    const assessRes = await fetch(`${pythonWorkerUrl}/analysis/assess-factors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selection_id: selectionData.selection_id,
        method: method
      })
    });

    if (!assessRes.ok) throw new Error('Worker failed during processing layer.');
    const assessmentData = await assessRes.json();

    // ── 3. STORE LIGHTWEIGHT RECEIPT IN MONGODB ─────────────────────
    // We only persist a tiny metadata "receipt" for backtracking:
    // - What was analyzed (target, method)
    // - The compact results (rankings object)
    // - A timestamp
    // NO raw CSV data is ever stored. This keeps MongoDB usage near 0 KB.
    try {
      const mongoClient = await clientPromise;
      const db = mongoClient.db('rate_app_atlas');
      
      // Ensure the TTL index exists (MongoDB auto-deletes after 1 hour)
      // createIndex is idempotent — safe to call on every request.
      await db.collection('sessionReceipts').createIndex(
        { "createdAt": 1 },
        { expireAfterSeconds: 3600 }  // 1 hour self-destruct
      );

      await db.collection('sessionReceipts').insertOne({
        datasetId,
        targetVariable,
        method,
        features: features?.slice(0, 10) || [],   // Store only first 10 feature names
        resultSummary: assessmentData.results_json, // Compact rankings object (~1 KB)
        createdAt: new Date()                       // TTL anchor
      });
    } catch (mongoError) {
      // MongoDB is non-critical. If it fails, the pipeline still works.
      console.warn('⚠️ MongoDB Receipt Error (Non-critical):', mongoError);
    }

    // ── 4. CACHE RESULT IN REDIS FOR SESSION ────────────────────────
    // Store for 1 hour. Same analysis = instant return.
    try {
      if (assessmentData) {
          await redis.set(cacheKey, JSON.stringify(assessmentData), 'EX', 3600);
      }
    } catch (redisError) {
      console.warn('⚠️ Redis Cache Set Error:', redisError);
    }

    // ── 5. PURGE RAW CSV FROM PYTHON SERVER ─────────────────────────
    // The analysis is complete. The raw file is no longer needed.
    // We fire-and-forget a cleanup request to keep the server ephemeral.
    try {
      fetch(`${pythonWorkerUrl}/datasets/purge-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([datasetId])
      }).catch(() => {}); // Fire-and-forget, don't block the response
    } catch (_) {
      // Purge failure is non-critical
    }

    return NextResponse.json({ 
      source: 'Python ML Worker (Freshly Computed)', 
      data: assessmentData 
    });

  } catch (error: any) {
    console.error('Serverless Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' }, 
      { status: 500 }
    );
  }
}
