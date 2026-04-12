import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { datasetsMetadata } = body;

        let promptText = `I have uploaded ${datasetsMetadata.length} datasets. Here is their metadata:\n`;
        datasetsMetadata.forEach((meta: any, idx: number) => {
            promptText += `\nDataset ${idx + 1} (${meta.file_name}):\n- Columns: ${meta.columns_list.join(', ')}\n- Total Rows: ${meta.rows}\n`;
        });

        promptText += `\nBased on this, act as an expert Data Scientist. 
Provide a strict JSON response containing the best target to predict, a list of optimal predictive features to focus on, and a concise reasoning paragraph.
DO NOT include any features or target that are not strictly present in the provided columns!

Return exactly and ONLY a JSON object evaluating this with the following structure:
{
  "target": "target_column_name",
  "features": ["feature_1", "feature_2"],
  "reasoning": "your paragraph explaining the rationale behind this recommendation"
}`;

        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "You are an expert data science assistant. You must reply strictly in valid JSON." },
                    { role: "user", content: promptText }
                ],
                response_format: { type: "json_object" }
            })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error?.message || "Groq API error");
        }

        const insight = JSON.parse(data.choices[0].message.content);
        return NextResponse.json({ success: true, insight });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
