'use client'
import { useState } from 'react'

interface Props {
  onClose: () => void
}

export default function AIAssistant({ onClose }: Props) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '👋 I\'m the Agnipariksha AI Assistant. I can help you:\n\n• Analyze live test data\n• Predict LeTID degradation outcomes\n• Detect anomalies in current/voltage readings\n• Answer questions about test standards (IEC 61215, IEC 61730)\n• Generate test reports\n\nWhat would you like to know?' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const send = async () => {
    if (!input.trim()) return
    const userMsg = input
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)
    // TODO: Call /api/ai with Claude MCP
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I received your query: "${userMsg}"\n\nConnect your Anthropic API key in .env to enable full AI responses with live data analysis.`
      }])
      setLoading(false)
    }, 800)
  }

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-gray-900 border-l border-gray-700 flex flex-col z-50 shadow-2xl">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-white">🤖 AI Assistant</h3>
          <p className="text-xs text-gray-400">Powered by Claude MCP</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.map((msg, i) => (
          <div key={i} className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap
            ${msg.role === 'user'
              ? 'bg-blue-900 text-blue-100 ml-8'
              : 'bg-gray-800 text-gray-200 mr-8'
            }`}>
            {msg.content}
          </div>
        ))}
        {loading && <div className="bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 mr-8 animate-pulse">Thinking...</div>}
      </div>

      <div className="p-4 border-t border-gray-700 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask about test data, standards, anomalies..."
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button onClick={send} className="btn-primary text-sm px-3">Send</button>
      </div>
    </div>
  )
}
