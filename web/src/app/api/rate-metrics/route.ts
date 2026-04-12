import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { redis } from '@/lib/redis';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { datasetId, targetVariable, features, method } = body;

    if (!datasetId || !targetVariable) {
      return NextResponse.json({ error: 'Missing required parameters.' }, { status: 400 });
    }

    // 1. CHECK UPSTASH REDIS CACHE
    // We stringify the payload constraints as a unique cache key
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
      console.log('✅ Edge Cache Hit! Bypassing heavy Python computation.');
      return NextResponse.json({ 
        source: 'Upstash Redis / Native Redis', 
        data: cachedResult 
      });
    }

    console.log('❌ Cache Miss. Routing to Python Worker...');

    // 2. ROUTE TO FASTAPI (PYTHON ML WORKER)
    // In production, replace localhost with your Render, AWS, or Railway URL
    const pythonWorkerUrl = process.env.PYTHON_WORKER_URL || process.env.NEXT_PUBLIC_PYTHON_WORKER_URL || 'https://fatty04-rate.hf.space';
    
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

    // Step B: Trigger Heavy Assessment (PPO/ANOVA)
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

    // 3. PERSIST METADATA TO MONGODB ATLAS
    // Keep a permanent record of who ran this and when.
    try {
      const mongoClient = await clientPromise;
      const db = mongoClient.db('rate_app_atlas'); // MongoDB Database Name
      
      await db.collection('assessmentLogs').insertOne({
        datasetId,
        targetVariable,
        method,
        executedAt: new Date(),
        resultPreview: assessmentData.results_json
      });
    } catch (mongoError) {
      console.warn('⚠️ MongoDB Atlas Error (Could not log result):', mongoError);
    }

    // 4. SAVE HEAVY RESULT IN UPSTASH REDIS
    // Store the processed data for exactly 1 hour (3600 seconds) 
    // to instantly return it next time someone requests the same exact configuration!
    try {
      if (assessmentData) {
          await redis.set(cacheKey, JSON.stringify(assessmentData), 'EX', 3600);
      }
    } catch (redisError) {
      console.warn('⚠️ Redis Cache Set Error:', redisError);
    }

    return NextResponse.json({ 
      source: 'Python ML Worker (Newly Computed)', 
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
