import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { message, context } = await req.json();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      response: `[Demo Mode — No API Key]\n\nQuery: "${message}"\n\nSystem Context:\n${context}\n\nTo enable full AI analysis, add ANTHROPIC_API_KEY to .env.local`,
    });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: `You are an expert PV module reliability test engineer with deep knowledge of IEC 61215, IEC 62979, IEC 61730, and IEC TS 63342 standards. You are helping analyse data from an ITECH PV6000 DC power supply test station called Agnipariksha. Be concise, technical, and precise. When analysing test data, reference specific IEC limits.`,
        messages: [
          {
            role: 'user',
            content: `Test Station Context:\n${context}\n\nUser Query: ${message}`,
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return NextResponse.json({ response: data.content[0].text });
  } catch (err) {
    return NextResponse.json({ response: `Error calling Claude API: ${err}` }, { status: 500 });
  }
}
