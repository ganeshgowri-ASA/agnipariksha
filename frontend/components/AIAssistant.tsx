'use client';
import { useState, useRef } from 'react';
import type { TestSession, LiveReading } from '@/app/page';

interface Props {
  sessions: Record<string, TestSession | null>;
  readings: LiveReading[];
}

const QUICK_PROMPTS = [
  'Analyse all test results and give pass/fail summary',
  'Detect any anomalies in the live data',
  'What is the LeTID degradation trend?',
  'Generate a compliance report for IEC 61215',
  'Compare current readings with IEC limits',
  'What SCPI commands are needed for Thermal Cycling?',
];

export default function AIAssistant({ sessions, readings }: Props) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; content: string; ts: number }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const buildContext = () => {
    const sessionSummary = Object.entries(sessions)
      .filter(([, s]) => s)
      .map(([k, s]) => {
        const avgV = s!.readings.length ? (s!.readings.reduce((a, r) => a + r.voltage, 0) / s!.readings.length).toFixed(3) : 'N/A';
        const avgI = s!.readings.length ? (s!.readings.reduce((a, r) => a + r.current, 0) / s!.readings.length).toFixed(3) : 'N/A';
        return `${k.toUpperCase()}: status=${s!.status}, result=${s!.result || 'pending'}, readings=${s!.readings.length}, avgV=${avgV}V, avgI=${avgI}A`;
      }).join('\n');

    const last5 = readings.slice(-5).map(r => `V=${r.voltage}V I=${r.current}A P=${r.power}kW T=${r.temperature || 'N/A'}°C`).join('; ');

    return `ITECH PV6000 Test Station (Agnipariksha)\nTest Sessions:\n${sessionSummary || 'None active'}\nLatest readings: ${last5 || 'None'}`;
  };

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg) return;
    setInput('');
    const userMsg = { role: 'user' as const, content: msg, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, context: buildContext() }),
      });

      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', content: data.response, ts: Date.now() }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'ai',
        content: `[Demo Mode] AI analysis for: "${msg}"\n\nBased on the current test data:\n• All 6 test tabs are operational\n• ITECH PV6000 SCPI interface ready at 192.168.200.100:30000\n• Demo mode active — connect to real hardware to enable live AI analysis\n\nFor full AI capabilities, set ANTHROPIC_API_KEY in .env.local`,
        ts: Date.now()
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">🤖</span>
        <h2 className="text-lg font-bold text-white">Agnipariksha AI Assistant</h2>
        <span className="text-xs text-gray-400 ml-auto">Powered by Claude MCP · Context-aware</span>
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap gap-2">
        {QUICK_PROMPTS.map(p => (
          <button key={p} onClick={() => sendMessage(p)}
            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs rounded border border-gray-600 transition-colors">
            {p}
          </button>
        ))}
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto bg-gray-900 rounded-xl border border-gray-700 p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            <p className="text-4xl mb-4">🔬</p>
            <p className="font-medium">Ask about test data, IEC compliance, SCPI commands, or anomaly detection</p>
            <p className="text-xs mt-2 text-gray-600">Context includes all active test sessions and live instrument readings</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
              m.role === 'user' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-200'
            }`}>
              {m.role === 'ai' && <span className="text-xs text-gray-400 block mb-1">🤖 Agnipariksha AI</span>}
              <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
              <span className="text-xs opacity-50 mt-1 block">{new Date(m.ts).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-xl px-4 py-3">
              <div className="flex gap-1 items-center">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
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
        <button onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
          Send
        </button>
      </div>
    </div>
  );
}
