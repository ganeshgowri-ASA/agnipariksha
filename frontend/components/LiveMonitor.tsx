'use client'
import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

interface Reading {
  time: string
  voltage: number
  current: number
  power: number
}

interface Props {
  liveData: { voltage: number; current: number; power: number }
  testId: string
}

const MAX_POINTS = 120  // 60 seconds at 2 Hz

export default function LiveMonitor({ liveData, testId }: Props) {
  const [data, setData] = useState<Reading[]>([])
  const tickRef = useRef(0)

  useEffect(() => {
    tickRef.current++
    const time = new Date().toLocaleTimeString('en', { hour12: false })
    setData(prev => [
      ...prev.slice(-MAX_POINTS + 1),
      { time, voltage: liveData.voltage, current: liveData.current, power: liveData.power }
    ])
  }, [liveData])

  const chartProps = {
    data,
    margin: { top: 5, right: 10, left: 0, bottom: 5 }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Voltage Chart */}
      <div className="chart-container">
        <div className="text-xs text-gray-500 mb-1 px-2">V — Voltage (V)</div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', color: '#f9fafb' }} />
            <Line type="monotone" dataKey="voltage" stroke="#3b82f6" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Current Chart */}
      <div className="chart-container">
        <div className="text-xs text-gray-500 mb-1 px-2">A — Current (A)</div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', color: '#f9fafb' }} />
            <Line type="monotone" dataKey="current" stroke="#10b981" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
