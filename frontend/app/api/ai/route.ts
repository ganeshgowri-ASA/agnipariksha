import type { NextRequest } from 'next/server';

export const runtime = 'edge';

const SYSTEM_PROMPT = `You are an expert PV module reliability test engineer with deep knowledge of IEC 61215 (MQT11 Thermal Cycling, MQT12 Humidity Freeze), IEC 62979 (Bypass Diode Thermal Test), IEC 61730 (MST13 Ground Continuity, MST26 Reverse Current Overload), and IEC TS 63342 (LeTID). You assist operators of an ITECH PV6000 DC power supply test station called Agnipariksha. Be concise, technical, and reference specific IEC limits when analyzing data. When detecting anomalies, cite the readings. When suggesting next steps, justify with standards.`;

function errorStream(message: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(message));
      controller.close();
    },
  });
}

async function streamAnthropic(apiKey: string, message: string, context: string): Promise<Response> {
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Test Station Context:\n${context}\n\nUser Query: ${message}` },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return new Response(
      errorStream(`Anthropic upstream error (${upstream.status}): ${text.slice(0, 500)}`),
      { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
            const text = json.delta.text as string;
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch {
          // ignore non-JSON keepalive frames
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function streamOpenRouter(apiKey: string, message: string, context: string): Promise<Response> {
  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/ganeshgowri-asa/agnipariksha',
      'X-Title': 'Agnipariksha PV Test Station',
    },
    body: JSON.stringify({
      model: 'xiaomi/mimo',
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Test Station Context:\n${context}\n\nUser Query: ${message}` },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return new Response(
      errorStream(`OpenRouter upstream error (${upstream.status}): ${text.slice(0, 500)}`),
      { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            controller.enqueue(encoder.encode(delta));
          }
        } catch {
          // ignore non-JSON frames
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { message?: string; context?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const message = (body.message ?? '').toString();
  const context = (body.context ?? '').toString();

  if (!message.trim()) {
    return new Response('Missing "message"', { status: 400 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  try {
    if (anthropicKey) {
      return await streamAnthropic(anthropicKey, message, context);
    }
    if (openRouterKey) {
      return await streamOpenRouter(openRouterKey, message, context);
    }
  } catch {
    return new Response(
      errorStream('[AI provider error] Upstream request failed. Please retry.'),
      { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  const demo = [
    '[Demo Mode — No API key configured]',
    '',
    `Query: ${message}`,
    '',
    'Context received:',
    context || '(empty)',
    '',
    'Configure ANTHROPIC_API_KEY (preferred, claude-opus-4-5) or OPENROUTER_API_KEY (xiaomi/mimo) in .env.local to enable streaming responses.',
  ].join('\n');

  return new Response(errorStream(demo), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
