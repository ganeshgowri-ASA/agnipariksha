import { NextRequest, NextResponse } from 'next/server';
import { fallbackStore } from '../../_fallback';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export const dynamic = 'force-dynamic';
// SSE responses must NOT be statically optimised.
export const runtime = 'nodejs';

interface SendBody {
  message?: string;
  test_run_id?: number;
  context?: Record<string, unknown>;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ moduleId: string }> },
): Promise<Response> {
  const { moduleId } = await context.params;
  const id = decodeURIComponent(moduleId);
  let body: SendBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }

  // Try the real backend first. If it answers, proxy its SSE byte-for-byte.
  try {
    const upstream = await fetch(
      `${BACKEND_BASE}/api/assistant/threads/${encodeURIComponent(id)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (upstream.ok && upstream.body) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }
  } catch {
    /* fall through to in-process demo stream */
  }

  // Backend down: synthesize a small SSE stream in-process so the UI
  // continues to demo the threaded experience. Messages are still
  // persisted to the fallback store keyed by the same module id.
  return new Response(buildDemoStream(id, body), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function sse(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const lines = payload.split('\n').map(l => `data: ${l}`).join('\n');
  return `event: ${event}\n${lines}\n\n`;
}

function buildDemoStream(moduleId: string, body: SendBody): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      fallbackStore.append(moduleId, {
        role: 'user', content: body.message ?? '', ts: Date.now() / 1000,
      });
      const threadId = fallbackStore.read(moduleId).thread_id;
      controller.enqueue(enc.encode(sse('meta', {
        thread_id: threadId, module_id: moduleId, demo: true, model: 'demo',
        ts: Date.now() / 1000,
      })));
      const lower = (body.message ?? '').toLowerCase();
      const runId = body.test_run_id ?? null;
      const callName = lower.includes('verdict') || lower.includes('pass') || lower.includes('fail')
        ? 'suggest_pass_fail'
        : lower.includes('delta') || lower.includes('pmax')
        ? 'recompute_analysis'
        : lower.includes('telemetry') || lower.includes('samples')
        ? 'query_telemetry'
        : 'get_run';
      const args: Record<string, unknown> = runId !== null ? { test_run_id: runId } : { module_id: moduleId };
      controller.enqueue(enc.encode(sse('tool_call', { name: callName, args })));
      controller.enqueue(enc.encode(sse('tool_result', {
        name: callName,
        result: {
          demo: true,
          note: 'Backend offline — synthesized demo result.',
          module_id: moduleId,
          test_run_id: runId,
        },
      })));
      const narrative =
        `Module ${moduleId} — demo response (backend offline). ` +
        `I would have called \`${callName}\` with ${JSON.stringify(args)} ` +
        `and reported the result here. Start the FastAPI backend on ` +
        `${BACKEND_BASE} for the live tools.`;
      for (const chunk of narrative.match(/.{1,60}(\s|$)/g) ?? [narrative]) {
        controller.enqueue(enc.encode(sse('token', { text: chunk })));
        await new Promise(r => setTimeout(r, 20));
      }
      fallbackStore.append(moduleId, {
        role: 'assistant',
        content: narrative,
        ts: Date.now() / 1000,
        tool_calls: [{ name: callName, args }],
        tool_results: [{ name: callName, result: { demo: true } }],
      });
      controller.enqueue(enc.encode(sse('done', { thread_id: threadId, chars: narrative.length })));
      controller.close();
    },
  });
}
