'use client';

import { useEffect, useRef, useState } from 'react';
import type { TestSession, LiveReading } from '@/app/page';

interface Props {
  sessions: Record<string, TestSession | null>;
  readings: LiveReading[];
}

const QUICK_PROMPTS: string[] = [
  'Analyze last LeTID run',
  'Detect anomalies',
  'Predict TC outcome',
  'Summarize Pass/Fail',
  'Suggest next test',
  'Explain IEC limits',
];

type ChatMsg = { role: 'user' | 'ai'; content: string; ts: number };

function buildContext(sessions: Record<string, TestSession | null>, readings: LiveReading[]): string {
  const summary = Object.entries(sessions)
    .filter(([, s]) => s)
    .map(([k, s]) => {
      const r = s!.readings;
      const avgV = r.length ? (r.reduce((a, x) => a + x.voltage, 0) / r.length).toFixed(3) : 'N/A';
      const avgI = r.length ? (r.reduce((a, x) => a + x.current, 0) / r.length).toFixed(3) : 'N/A';
      const avgP = r.length ? (r.reduce((a, x) => a + x.power, 0) / r.length).toFixed(3) : 'N/A';
      const dur  = (((s!.endTime || Date.now()) - s!.startTime) / 60000).toFixed(1);
      return `- ${k.toUpperCase()}: status=${s!.status}, result=${s!.result || 'pending'}, readings=${r.length}, durationMin=${dur}, avgV=${avgV}V, avgI=${avgI}A, avgP=${avgP}kW`;
    })
    .join('\n');

  const tail = readings.slice(-10)
    .map(r => `V=${r.voltage.toFixed(3)} I=${r.current.toFixed(3)} P=${r.power.toFixed(3)}${r.temperature !== undefined ? ` T=${r.temperature.toFixed(1)}°C` : ''}`)
    .join(' | ');

  return [
    'Agnipariksha — ITECH PV6000 PV Module Reliability Test Station',
    'Test Sessions:',
    summary || '  (none)',
    `Latest live readings (most recent 10): ${tail || 'none'}`,
  ].join('\n');
}

export default function AIAssistant({ sessions, readings }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, ts: Date.now() }]);
    setLoading(true);

    const aiTs = Date.now();
    setMessages(prev => [...prev, { role: 'ai', content: '', ts: aiTs }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, context: buildContext(sessions, readings) }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`API error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'ai' && last.ts === aiTs) {
            next[next.length - 1] = { ...last, content: accumulated };
          }
          return next;
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        const fallback = `[AI unavailable] ${errMsg}\n\nSet ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env.local to enable live AI analysis. Live context was still attached:\n\n${buildContext(sessions, readings)}`;
        if (last && last.role === 'ai' && last.ts === aiTs && !last.content) {
          next[next.length - 1] = { ...last, content: fallback };
        } else {
          next.push({ role: 'ai', content: fallback, ts: Date.now() });
        }
        return next;
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">🤖</span>
        <h2 className="text-lg font-bold text-white">Agnipariksha AI Assistant</h2>
        <span className="text-xs text-gray-400 ml-auto">
          Streaming · Claude / OpenRouter · Context-aware
        </span>
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap gap-2">
        {QUICK_PROMPTS.map(p => (
          <button
            key={p}
            disabled={loading}
            onClick={() => sendMessage(p)}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 hover:text-white text-xs rounded border border-gray-600 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Chat */}
      <div className="flex-1 overflow-y-auto bg-gray-900 rounded-xl border border-gray-700 p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            <p className="text-4xl mb-4">🔬</p>
            <p className="font-medium">Ask about test data, IEC compliance, anomalies, or what to run next.</p>
            <p className="text-xs mt-2 text-gray-600">Each request includes a summary of the current session and the last 10 live readings.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
              m.role === 'user' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-200'
            }`}>
              {m.role === 'ai' && <span className="text-xs text-gray-400 block mb-1">🤖 Agnipariksha AI</span>}
              <pre className="whitespace-pre-wrap font-sans">
                {m.content}
                {loading && m.role === 'ai' && i === messages.length - 1 && (
                  <span className="inline-block w-2 h-4 bg-blue-400 ml-1 animate-pulse align-middle" />
                )}
              </pre>
              <span className="text-xs opacity-50 mt-1 block">{new Date(m.ts).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Ask about test results, anomalies, SCPI commands, IEC compliance..."
          className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        {loading ? (
          <button
            onClick={stop}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
