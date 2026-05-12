'use client';

import { useMemo, useState } from 'react';
import { GATE2_PMAX_DELTA_PERCENT, type TestSession } from '@/types/test-session';
import RaiseTicketButton from '@/components/tickets/RaiseTicketButton';

interface ReportGeneratorProps {
  session: TestSession | null;
  testName: string;
  standard: string;
}

const BRAND_LAB = 'Shreshtata Power Supplies — ASA PV Testing Laboratory';

function buildPowerChartPng(session: TestSession, w = 720, h = 220): string | null {
  if (typeof document === 'undefined' || session.readings.length === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const ps = session.readings.map(r => r.power);
  const ts = session.readings.map(r => r.timestamp - session.startTime);
  const pMin = Math.min(...ps);
  const pMax = Math.max(...ps);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const padL = 48, padR = 12, padT = 16, padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Background
  ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, w, h);
  // Title
  ctx.fillStyle = '#e5e7eb'; ctx.font = 'bold 12px Helvetica';
  ctx.fillText('Power trend (W vs elapsed minutes)', padL, 12);
  // Axes
  ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // Y ticks
  ctx.fillStyle = '#9ca3af'; ctx.font = '10px Helvetica'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i) / 4;
    const v = pMin + ((pMax - pMin) * i) / 4;
    ctx.fillText(v.toFixed(2), padL - 4, y + 3);
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
  }
  ctx.textAlign = 'left';

  // Gate-2 floor
  if (session.preMaxPower != null || ps.length > 0) {
    const pre = session.preMaxPower ?? ps[0];
    const floor = pre * (1 + GATE2_PMAX_DELTA_PERCENT / 100);
    if (floor >= pMin && floor <= pMax) {
      const y = padT + plotH - ((floor - pMin) / Math.max(1e-9, pMax - pMin)) * plotH;
      ctx.strokeStyle = '#ef4444'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ef4444'; ctx.fillText('Gate-2 floor', padL + 4, y - 3);
    }
  }

  // Power line
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < ps.length; i++) {
    const x = padL + ((ts[i] - tMin) / Math.max(1, tMax - tMin)) * plotW;
    const y = padT + plotH - ((ps[i] - pMin) / Math.max(1e-9, pMax - pMin)) * plotH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // X-axis labels (minutes)
  ctx.fillStyle = '#9ca3af'; ctx.textAlign = 'center';
  const tMaxMin = (tMax - tMin) / 60_000;
  ctx.fillText('0 min', padL, padT + plotH + 14);
  ctx.fillText(`${tMaxMin.toFixed(1)} min`, padL + plotW, padT + plotH + 14);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

export default function ReportGenerator({ session, testName, standard }: ReportGeneratorProps) {
  const [loading, setLoading] = useState<'pdf' | 'word' | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [labName, setLabName] = useState(BRAND_LAB);
  const [moduleId, setModuleId] = useState('');
  const [notes, setNotes] = useState('');
  const [rawPath, setRawPath] = useState('');

  const stats = useMemo(() => {
    if (!session || session.readings.length === 0) return null;
    const rs = session.readings;
    const ps = rs.map(r => r.power);
    const pre = session.preMaxPower ?? ps[0];
    const post = session.postMaxPower ?? ps[ps.length - 1];
    const delta = pre > 0 ? ((post - pre) / pre) * 100 : 0;
    return {
      count: rs.length,
      avgV: rs.reduce((a, r) => a + r.voltage, 0) / rs.length,
      avgI: rs.reduce((a, r) => a + r.current, 0) / rs.length,
      avgP: ps.reduce((a, b) => a + b, 0) / ps.length,
      maxV: Math.max(...rs.map(r => r.voltage)),
      minV: Math.min(...rs.map(r => r.voltage)),
      pre, post, delta,
      gatePass: delta >= GATE2_PMAX_DELTA_PERCENT,
      duration: session.endTime
        ? ((session.endTime - session.startTime) / 60_000).toFixed(1)
        : ((Date.now() - session.startTime) / 60_000).toFixed(1),
    };
  }, [session]);

  const verdict = !stats
    ? 'IN PROGRESS'
    : session?.result ?? (stats.gatePass ? 'PASS' : 'FAIL');

  const generatePDF = async () => {
    if (!session) return;
    setLoading('pdf');
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();

      // Header band
      doc.setFillColor(17, 24, 39); doc.rect(0, 0, pageW, 40, 'F');
      doc.setTextColor(255, 165, 0);
      doc.setFontSize(20); doc.setFont('helvetica', 'bold');
      doc.text('AGNIPARIKSHA', 14, 16);
      doc.setTextColor(200, 200, 200);
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text('PV Module Reliability Test Report', 14, 24);
      doc.text(labName, pageW - 14, 24, { align: 'right' });

      // Test title
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14); doc.setFont('helvetica', 'bold');
      doc.text(testName, 14, 52);
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
      doc.text(`Standard: ${standard}  ·  Clause: ${session.iecClause ?? standard}`, 14, 59);

      autoTable(doc, {
        startY: 65,
        head: [['Parameter', 'Value']],
        body: [
          ['Test Type', testName],
          ['Standard', standard],
          ['IEC Clause', session.iecClause ?? standard],
          ['Module ID', moduleId || 'N/A'],
          ['Operator', operatorName || 'N/A'],
          ['Date', new Date(session.startTime).toLocaleDateString()],
          ['Start Time', new Date(session.startTime).toLocaleTimeString()],
          ['Duration (min)', stats?.duration ?? 'N/A'],
          ['Total Readings', stats?.count.toString() ?? '0'],
          ['Raw data file', rawPath || session.rawDataPath || 'N/A'],
        ],
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });

      if (stats) {
        const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
        autoTable(doc, {
          startY: finalY,
          head: [['Measurement', 'Min', 'Average', 'Max']],
          body: [
            ['Voltage (V)', stats.minV.toFixed(4), stats.avgV.toFixed(4), stats.maxV.toFixed(4)],
            ['Current (A)', '—', stats.avgI.toFixed(4), '—'],
            ['Power (W)',   '—', stats.avgP.toFixed(4), '—'],
          ],
          styles: { fontSize: 9, cellPadding: 3 },
          headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
        });

        const gateY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
        autoTable(doc, {
          startY: gateY,
          head: [['Gate Check', 'Pre Pmax', 'Post Pmax', 'ΔPmax %', 'Threshold', 'Verdict']],
          body: [[
            'IEC 61215-2 Gate 2',
            stats.pre.toFixed(3),
            stats.post.toFixed(3),
            stats.delta.toFixed(2),
            `${GATE2_PMAX_DELTA_PERCENT}%`,
            stats.gatePass ? 'PASS' : 'FAIL',
          ]],
          styles: { fontSize: 9, cellPadding: 3 },
          headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
          bodyStyles: { textColor: stats.gatePass ? [21, 128, 61] : [185, 28, 28] },
        });
      }

      // Embed power-trend chart
      const chart = buildPowerChartPng(session);
      if (chart) {
        const chartY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
        doc.text('Power Trend', 14, chartY);
        doc.addImage(chart, 'PNG', 14, chartY + 4, pageW - 28, 60);
      }

      if (notes) {
        const yState = doc as unknown as { lastAutoTable?: { finalY: number } };
        const notesY = (yState.lastAutoTable?.finalY ?? 200) + 80;
        doc.setFontSize(11); doc.setFont('helvetica', 'bold');
        doc.text('Notes', 14, notesY);
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text(notes, 14, notesY + 7, { maxWidth: pageW - 28 });
      }

      // Footer + verdict band
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setTextColor(150, 150, 150);
        doc.text(
          `Agnipariksha · ${labName} · Page ${i} of ${pageCount}`,
          pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' },
        );
      }

      doc.save(`${testName.replace(/\s+/g, '_')}_Report_${Date.now()}.pdf`);
    } catch (e) {
      console.error(e);
    }
    setLoading(null);
  };

  const generateWord = async () => {
    if (!session) return;
    setLoading('word');
    try {
      const docx = await import('docx');
      const {
        Document, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, Packer, WidthType, ImageRun,
      } = docx;

      const rows: Array<[string, string]> = [
        ['Test Type', testName], ['Standard', standard],
        ['IEC Clause', session.iecClause ?? standard],
        ['Module ID', moduleId || 'N/A'],
        ['Operator', operatorName || 'N/A'],
        ['Date', new Date(session.startTime).toLocaleDateString()],
        ['Duration (min)', stats?.duration ?? 'N/A'],
        ['Total Readings', stats?.count.toString() ?? '0'],
        ['Raw data file', rawPath || session.rawDataPath || 'N/A'],
        ['Verdict', verdict],
      ];

      let chartImageRun: InstanceType<typeof ImageRun> | null = null;
      const chart = buildPowerChartPng(session);
      if (chart) {
        const base64 = chart.split(',')[1];
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        chartImageRun = new ImageRun({
          data: bytes,
          transformation: { width: 600, height: 180 },
          type: 'png',
        });
      }

      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({ text: 'AGNIPARIKSHA', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'PV Module Reliability Test Report', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ children: [new TextRun({ text: labName, italics: true, color: '666666' })] }),
            new Paragraph(''),
            new Paragraph({ text: testName, heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ children: [new TextRun({ text: `Standard: ${standard}`, italics: true, color: '666666' })] }),
            new Paragraph(''),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: rows.map(([k, v]) => new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: k, bold: true })] })] }),
                  new TableCell({ children: [new Paragraph(v)] }),
                ],
              })),
            }),
            new Paragraph(''),
            ...(chartImageRun ? [
              new Paragraph({ text: 'Power Trend', heading: HeadingLevel.HEADING_2 }),
              new Paragraph({ children: [chartImageRun] }),
            ] : []),
            ...(notes ? [
              new Paragraph(''),
              new Paragraph({ text: 'Notes', heading: HeadingLevel.HEADING_2 }),
              new Paragraph(notes),
            ] : []),
            new Paragraph(''),
            new Paragraph({ children: [new TextRun({
              text: `Generated by Agnipariksha on ${new Date().toLocaleString()}`,
              italics: true, color: '888888', size: 18,
            })] }),
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${testName.replace(/\s+/g, '_')}_Report_${Date.now()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    }
    setLoading(null);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3">
        <h3 className="text-sm font-bold text-gray-200">Report Configuration</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Module ID',    value: moduleId,     set: setModuleId,     ph: 'e.g. MOD-2026-001' },
            { label: 'Operator',     value: operatorName, set: setOperatorName, ph: 'Your name' },
            { label: 'Laboratory',   value: labName,      set: setLabName,      ph: 'Lab name' },
            { label: 'Raw data path', value: rawPath,     set: setRawPath,      ph: '/data/runs/...' },
          ].map(f => (
            <div key={f.label}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <input
                value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
              />
            </div>
          ))}
          <div className="col-span-2">
            <label className="text-xs text-gray-400 block mb-1">Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Observations, deviations..."
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 resize-none"
            />
          </div>
        </div>
      </div>

      {stats && (
        <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
          <h3 className="text-sm font-bold text-gray-200 mb-3">Test Summary</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Avg Voltage" value={stats.avgV.toFixed(3)} unit="V" color="text-blue-400" />
            <Stat label="Avg Current" value={stats.avgI.toFixed(3)} unit="A" color="text-green-400" />
            <Stat label="Duration"    value={stats.duration}        unit="min" color="text-yellow-400" />
            <Stat label="ΔPmax"       value={stats.delta.toFixed(2)} unit="%"
                  color={stats.gatePass ? 'text-green-400' : 'text-red-400'} />
            <Stat label="Pre Pmax"    value={stats.pre.toFixed(3)}  unit="W" color="text-gray-200" />
            <Stat label="Post Pmax"   value={stats.post.toFixed(3)} unit="W" color="text-gray-200" />
          </div>
          <div className={`mt-3 py-2 text-center rounded font-bold text-sm ${
            verdict === 'PASS' ? 'bg-green-900/50 text-green-400'
              : verdict === 'FAIL' ? 'bg-red-900/50 text-red-400'
                : 'bg-gray-800 text-gray-400'
          }`}>
            {verdict}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button" onClick={generatePDF}
          disabled={loading !== null || !session}
          className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm rounded font-medium transition-colors"
        >
          {loading === 'pdf' ? 'Generating…' : 'Export PDF'}
        </button>
        <button
          type="button" onClick={generateWord}
          disabled={loading !== null || !session}
          className="flex-1 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded font-medium transition-colors"
        >
          {loading === 'word' ? 'Generating…' : 'Export Word'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-800">
        <p className="text-[11px] text-gray-500">
          Spotted an issue with this run or the equipment?
        </p>
        <RaiseTicketButton
          size="md"
          label="Raise ticket"
          defaults={{
            type: 'complaint',
            source: 'report_tab',
            title: session ? `${testName}: report issue (${session.id})` : `${testName}: report issue`,
            description: session
              ? `Standard: ${standard}\nSession: ${session.id}\nStatus: ${session.status}\nReadings: ${session.readings.length}`
              : `Standard: ${standard}`,
            links: session ? { test_run_id: session.id } : undefined,
            tags: [testName, standard],
          }}
        />
      </div>
    </div>
  );
}

function Stat({
  label, value, unit, color = 'text-white',
}: { label: string; value: string; unit: string; color?: string }) {
  return (
    <div className="bg-gray-800 rounded p-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-mono font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{unit}</p>
    </div>
  );
}
