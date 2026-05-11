'use client'
import { useState, useEffect } from 'react'
import LiveMonitor from '@/components/LiveMonitor'
import AnalogGauge from '@/components/AnalogGauge'
import AIAssistant from '@/components/AIAssistant'

const TESTS = [
  { id: 'tc',    label: 'TC',    name: 'Thermal Cycling',        standard: 'IEC 61215-2 MQT 11', color: 'bg-orange-600' },
  { id: 'hf',    label: 'HF',    name: 'Humidity Freeze',         standard: 'IEC 61215-2 MQT 12', color: 'bg-blue-600' },
  { id: 'letid', label: 'LeTID', name: 'LeTID',                   standard: 'IEC TS 63342:2022',  color: 'bg-yellow-600' },
  { id: 'bdt',   label: 'BDT',   name: 'Bypass Diode Thermal',    standard: 'IEC 62979:2017',     color: 'bg-red-600' },
  { id: 'rco',   label: 'RCO',   name: 'Reverse Current Overload',standard: 'IEC 61730-2 MST 26', color: 'bg-purple-600' },
  { id: 'gct',   label: 'GCT',   name: 'Ground Continuity',       standard: 'IEC 61730-2 MST 13', color: 'bg-green-600' },
]

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('tc')
  const [connected, setConnected] = useState(false)
  const [liveData, setLiveData] = useState({ voltage: 0, current: 0, power: 0 })
  const [showAI, setShowAI] = useState(false)

  useEffect(() => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws')
    ws.onopen = () => setConnected(true)
    ws.onmessage = (e) => setLiveData(JSON.parse(e.data))
    ws.onclose = () => setConnected(false)
    return () => ws.close()
  }, [])

  const activeTest = TESTS.find(t => t.id === activeTab)!

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">🔥 Agnipariksha</h1>
          <p className="text-xs text-gray-500">PV Reliability Test Station · Shreshtata Power Supplies</p>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-xs px-2 py-1 rounded ${connected ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
            {connected ? '● ITECH Connected' : '○ Disconnected'}
          </span>
          <button onClick={() => setShowAI(!showAI)} className="btn-primary text-sm">
            🤖 AI Assistant
          </button>
        </div>
      </header>

      {/* Live Metrics Bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-2 flex gap-8">
        <div>
          <span className="text-xs text-gray-500">POWER</span>
          <div className="metric-display">{liveData.power.toFixed(2)} <span className="text-xs">kW</span></div>
        </div>
        <div>
          <span className="text-xs text-gray-500">VOLTAGE</span>
          <div className="metric-display">{liveData.voltage.toFixed(3)} <span className="text-xs">V</span></div>
        </div>
        <div>
          <span className="text-xs text-gray-500">CURRENT</span>
          <div className="metric-display">{liveData.current.toFixed(3)} <span className="text-xs">A</span></div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">ITECH IT6000C · 192.168.200.100:30000</span>
          <span className="text-xs text-gray-500">IT9000 PV6000 v1.0.3.3</span>
        </div>
      </div>

      {/* Test Tabs */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 flex gap-1 pt-2">
        {TESTS.map(test => (
          <button
            key={test.id}
            onClick={() => setActiveTab(test.id)}
            className={`px-4 py-2 rounded-t text-sm font-semibold border-b-2 transition-all
              ${activeTab === test.id
                ? 'bg-gray-800 text-white border-blue-500'
                : 'bg-transparent text-gray-400 border-transparent hover:text-white'
              }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full mr-2 ${test.color}`}></span>
            {test.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-white">{activeTest.name}</h2>
          <p className="text-sm text-gray-400">{activeTest.standard}</p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Live Charts — spans 2 cols */}
          <div className="col-span-2">
            <LiveMonitor liveData={liveData} testId={activeTab} />
          </div>

          {/* Gauges + Controls */}
          <div className="flex flex-col gap-4">
            <div className="card p-4">
              <h3 className="text-sm text-gray-400 mb-3">Live Gauges</h3>
              <AnalogGauge label="Vs (V)" value={liveData.voltage} min={0} max={100} unit="V" />
              <AnalogGauge label="I+ (A)" value={liveData.current} min={0} max={150} unit="A" />
            </div>
            <div className="card p-4 flex flex-col gap-2">
              <h3 className="text-sm text-gray-400 mb-1">Test Control</h3>
              <button className="btn-success w-full">▶ Start Test</button>
              <button className="btn-danger w-full">⬛ E-STOP</button>
              <button className="btn-primary w-full">📄 Generate Report</button>
            </div>
          </div>
        </div>
      </main>

      {/* AI Assistant Sidebar */}
      {showAI && <AIAssistant onClose={() => setShowAI(false)} />}
    </div>
  )
}
