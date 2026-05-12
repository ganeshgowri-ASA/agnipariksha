'use client';

import { useMemo, useState } from 'react';
import { GATE2_PMAX_DELTA_PERCENT, type TestSession } from '@/types/test-session';

/**
 * Figure 7 (IEC 61215-2 MQT 11) — temperature + current dual-trace plot.
 * Drawn to a hidden canvas and embedded as PNG in PDF/Word reports.
 */
function buildFig7Png(session: TestSession, w = 720, h = 260): string | null {
  if (typeof document === 'undefined' || session.readings.length === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const rs = session.readings;
  const ts = rs.map(r => r.timestamp - session.startTime);
  const temps = rs.map(r => r.temperature ?? 25);
  const currs = rs.map(r => r.current);
  const tMinX = Math.min(...ts);
  const tMaxX = Math.max(...ts);
  const tempLo = Math.min(-40, Math.min(...temps));
  const tempHi = Math.max(85, Math.max(...temps));
  const iLo = Math.min(0, Math.min(...currs));
  const iHi = Math.max(...currs);

  const padL = 56, padR = 48, padT = 28, padB = 32;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e5e7eb'; ctx.font = 'bold 12px Helvetica';
  ctx.fillText('IEC 61215-2 MQT 11 — Figure 7 (T + I vs time)', padL, 16);

  // Axes
  ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();
  // Right axis tick line
  ctx.beginPath();
  ctx.moveTo(padL + plotW, padT); ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // Y ticks — left (°C)
  ctx.fillStyle = '#9ca3af'; ctx.font = '10px Helvetica'; ctx.textAlign = 'right';
  for (let k = 0; k <= 4; k++) {
    const y = padT + plotH - (plotH * k) / 4;
    const v = tempLo + ((tempHi - tempLo) * k) / 4;
    ctx.fillText(`${v.toFixed(0)}°C`, padL - 4, y + 3);
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
  }
  // Y ticks — right (A)
  ctx.textAlign = 'left';
  for (let k = 0; k <= 4; k++) {
    const y = padT + plotH - (plotH * k) / 4;
    const v = iLo + ((iHi - iLo) * k) / 4;
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`${v.toFixed(2)} A`, padL + plotW + 4, y + 3);
  }

  // Temperature trace (red)
  ctx.strokeStyle = '#f87171'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < temps.length; i++) {
    const x = padL + ((ts[i] - tMinX) / Math.max(1, tMaxX - tMinX)) * plotW;
    const y = padT + plotH - ((temps[i] - tempLo) / Math.max(1e-9, tempHi - tempLo)) * plotH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current trace (amber)
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.25; ctx.beginPath();
  for (let i = 0; i < currs.length; i++) {
    const x = padL + ((ts[i] - tMinX) / Math.max(1, tMaxX - tMinX)) * plotW;
    const y = padT + plotH - ((currs[i] - iLo) / Math.max(1e-9, iHi - iLo)) * plotH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Legend
  ctx.font = '10px Helvetica';
  ctx.fillStyle = '#f87171'; ctx.fillRect(padL + 8, padT - 18, 12, 2);
  ctx.fillStyle = '#e5e7eb'; ctx.fillText('Temperature (°C)', padL + 24, padT - 14);
  ctx.fillStyle = '#fbbf24'; ctx.fillRect(padL + 160, padT - 18, 12, 2);
  ctx.fillStyle = '#e5e7eb'; ctx.fillText('Current (A) — Imp / 1 %', padL + 176, padT - 14);

  // X labels (minutes)
  const tMaxMin = (tMaxX - tMinX) / 60_000;
  ctx.fillStyle = '#9ca3af'; ctx.textAlign = 'center';
  ctx.fillText('0 min', padL, padT + plotH + 16);
  ctx.fillText(`${tMaxMin.toFixed(1)} min`, padL + plotW, padT + plotH + 16);

  return canvas.toDataURL('image/png');
}

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

      // MQT 11 — Figure 7 dual-trace chart + cycle log table
      if (session.mqt === 'MQT11' || /MQT\s*11/i.test(standard)) {
        doc.addPage();
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
        doc.text('IEC 61215-2 MQT 11 — Figure 7 Profile', 14, 18);
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
        doc.text(
          'Clause 4.11 — Temperature & continuity-current vs elapsed time.',
          14, 25,
        );
        const fig7 = buildFig7Png(session);
        if (fig7) {
          doc.addImage(fig7, 'PNG', 14, 30, pageW - 28, 80);
        }

        const log = session.cycleLog ?? [];
        if (log.length > 0) {
          autoTable(doc, {
            startY: 115,
            head: [[
              'Cycle', 'T_hot (°C)', 'T_cold (°C)',
              'Ramp up (°C/h)', 'Ramp down (°C/h)',
              'Hot dwell (s)', 'Cold dwell (s)',
              'I disc.', 'V disc.',
            ]],
            body: log.map(r => [
              r.cycle.toString(),
              r.t_hot_peak_c.toFixed(2),
              r.t_cold_peak_c.toFixed(2),
              r.avg_ramp_up_c_per_h.toFixed(1),
              r.avg_ramp_down_c_per_h.toFixed(1),
              r.hot_dwell_s.toFixed(0),
              r.cold_dwell_s.toFixed(0),
              r.current_discontinuities.toString(),
              r.voltage_discontinuities.toString(),
            ]),
            styles: { fontSize: 7, cellPadding: 1.5 },
            headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
            alternateRowStyles: { fillColor: [245, 245, 245] },
          });
        }

        // Gate 2 reference band + raw CSV
        const refY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 200;
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
        doc.text(
          'Pass criteria — IEC 61215-1 Gate 2: ΔPmax ≥ -5%',
          14, refY + 8,
        );
        doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
        const verdictLine = stats
          ? `Result: ΔPmax = ${stats.delta.toFixed(2)}%  →  ${stats.gatePass ? 'PASS' : 'FAIL'} (MQT 11)`
          : 'Result: pending';
        doc.text(verdictLine, 14, refY + 14);
        if (rawPath || session.rawDataPath) {
          doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
          doc.text(
            `Raw CSV (absolute): ${rawPath || session.rawDataPath}`,
            14, refY + 20, { maxWidth: pageW - 28 },
          );
        }
        doc.setTextColor(120, 120, 120);
        doc.text('IEC clause 4.11 — Thermal Cycling Test', 14, refY + 26);
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

      const toImageRun = (dataUrl: string | null, w = 600, h = 180): InstanceType<typeof ImageRun> | null => {
        if (!dataUrl) return null;
        const base64 = dataUrl.split(',')[1];
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new ImageRun({
          data: bytes, transformation: { width: w, height: h }, type: 'png',
        });
      };

      const chartImageRun = toImageRun(buildPowerChartPng(session));
      const fig7ImageRun = session.mqt === 'MQT11' || /MQT\s*11/i.test(standard)
        ? toImageRun(buildFig7Png(session), 620, 220)
        : null;

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
            ...(fig7ImageRun ? [
              new Paragraph({ text: 'IEC 61215-2 MQT 11 — Figure 7', heading: HeadingLevel.HEADING_2 }),
              new Paragraph({ children: [new TextRun({
                text: 'Clause 4.11 — Temperature + continuity current vs time',
                italics: true, color: '666666',
              })] }),
              new Paragraph({ children: [fig7ImageRun] }),
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

      {session?.mqt === 'MQT11' && session.cycleLog && session.cycleLog.length > 0 && (
        <div
          data-testid="mqt11-cycle-log"
          className="bg-gray-900 rounded-lg border border-gray-700 p-4 overflow-x-auto"
        >
          <h3 className="text-sm font-bold text-orange-400 mb-2">
            IEC 61215-2 MQT 11 — Cycle Log (Clause 4.11)
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            Pass criteria: IEC 61215-1 Gate 2 — ΔPmax ≥ −5 %. Raw CSV:&nbsp;
            <span className="font-mono text-gray-300">
              {rawPath || session.rawDataPath || '—'}
            </span>
          </p>
          <table className="text-[11px] w-full text-gray-200">
            <thead>
              <tr className="text-orange-300">
                <th className="text-left">Cycle</th>
                <th className="text-right">T_hot °C</th>
                <th className="text-right">T_cold °C</th>
                <th className="text-right">Ramp ↑ °C/h</th>
                <th className="text-right">Ramp ↓ °C/h</th>
                <th className="text-right">Hot dwell s</th>
                <th className="text-right">Cold dwell s</th>
                <th className="text-right">I disc</th>
                <th className="text-right">V disc</th>
              </tr>
            </thead>
            <tbody>
              {session.cycleLog.slice(0, 10).map(r => (
                <tr key={r.cycle} className="border-t border-gray-800">
                  <td className="font-mono">{r.cycle}</td>
                  <td className="text-right font-mono">{r.t_hot_peak_c.toFixed(2)}</td>
                  <td className="text-right font-mono">{r.t_cold_peak_c.toFixed(2)}</td>
                  <td className="text-right font-mono">{r.avg_ramp_up_c_per_h.toFixed(1)}</td>
                  <td className="text-right font-mono">{r.avg_ramp_down_c_per_h.toFixed(1)}</td>
                  <td className="text-right font-mono">{r.hot_dwell_s.toFixed(0)}</td>
                  <td className="text-right font-mono">{r.cold_dwell_s.toFixed(0)}</td>
                  <td className="text-right font-mono">{r.current_discontinuities}</td>
                  <td className="text-right font-mono">{r.voltage_discontinuities}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {session.cycleLog.length > 10 && (
            <p className="text-[11px] text-gray-500 mt-2">
              … {session.cycleLog.length - 10} more rows in exported report.
            </p>
          )}
        </div>
      )}

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
