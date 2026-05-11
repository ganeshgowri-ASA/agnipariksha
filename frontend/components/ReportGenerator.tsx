'use client';

import { useState } from 'react';
import type { TestSession } from '@/app/page';

interface ReportGeneratorProps {
  session: TestSession | null;
  testName: string;
  standard: string;
}

export default function ReportGenerator({ session, testName, standard }: ReportGeneratorProps) {
  const [loading, setLoading] = useState<'pdf' | 'word' | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [labName, setLabName] = useState('ASA PV Testing Laboratory');
  const [moduleId, setModuleId] = useState('');
  const [notes, setNotes] = useState('');

  const stats = session ? {
    count: session.readings.length,
    avgV: session.readings.reduce((a, r) => a + r.voltage, 0) / (session.readings.length || 1),
    avgI: session.readings.reduce((a, r) => a + r.current, 0) / (session.readings.length || 1),
    avgP: session.readings.reduce((a, r) => a + r.power, 0) / (session.readings.length || 1),
    maxV: Math.max(...session.readings.map(r => r.voltage)),
    minV: Math.min(...session.readings.map(r => r.voltage)),
    duration: session.endTime
      ? ((session.endTime - session.startTime) / 1000 / 60).toFixed(1)
      : ((Date.now() - session.startTime) / 1000 / 60).toFixed(1),
  } : null;

  const generatePDF = async () => {
    setLoading('pdf');
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();

      // Header
      doc.setFillColor(17, 24, 39);
      doc.rect(0, 0, pageW, 40, 'F');
      doc.setTextColor(255, 165, 0);
      doc.setFontSize(20); doc.setFont('helvetica', 'bold');
      doc.text('AGNIPARIKSHA', 14, 16);
      doc.setTextColor(200, 200, 200);
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text('PV Module Reliability Test Report', 14, 24);
      doc.text(`${labName}`, pageW - 14, 24, { align: 'right' });

      // Test Info
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14); doc.setFont('helvetica', 'bold');
      doc.text(testName, 14, 52);
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
      doc.text(`Standard: ${standard}`, 14, 59);

      autoTable(doc, {
        startY: 65,
        head: [['Parameter', 'Value']],
        body: [
          ['Test Type', testName],
          ['Standard', standard],
          ['Module ID', moduleId || 'N/A'],
          ['Operator', operatorName || 'N/A'],
          ['Date', new Date(session?.startTime || Date.now()).toLocaleDateString()],
          ['Start Time', new Date(session?.startTime || Date.now()).toLocaleTimeString()],
          ['Duration (min)', stats?.duration || 'N/A'],
          ['Total Readings', stats?.count.toString() || '0'],
          ['Test Result', session?.result || 'IN PROGRESS'],
        ],
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });

      if (stats) {
        const finalY = (doc as any).lastAutoTable.finalY + 10;
        autoTable(doc, {
          startY: finalY,
          head: [['Measurement', 'Min', 'Average', 'Max']],
          body: [
            ['Voltage (V)', stats.minV.toFixed(4), stats.avgV.toFixed(4), stats.maxV.toFixed(4)],
            ['Current (A)', '—', stats.avgI.toFixed(4), '—'],
            ['Power (W)', '—', stats.avgP.toFixed(4), '—'],
          ],
          styles: { fontSize: 9, cellPadding: 3 },
          headStyles: { fillColor: [17, 24, 39], textColor: [255, 165, 0] },
        });
      }

      if (notes) {
        const notesY = (doc as any).lastAutoTable.finalY + 10;
        doc.setFontSize(11); doc.setFont('helvetica', 'bold');
        doc.text('Notes', 14, notesY);
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text(notes, 14, notesY + 7, { maxWidth: pageW - 28 });
      }

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setTextColor(150, 150, 150);
        doc.text(`Agnipariksha PV Test Station — Page ${i} of ${pageCount}`, pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
      }

      doc.save(`${testName.replace(/\s+/g, '_')}_Report_${Date.now()}.pdf`);
    } catch (e) { console.error(e); }
    setLoading(null);
  };

  const generateWord = async () => {
    setLoading('word');
    try {
      const { Document, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, Packer, WidthType, BorderStyle } = await import('docx');

      const rows = [
        ['Test Type', testName], ['Standard', standard], ['Module ID', moduleId || 'N/A'],
        ['Operator', operatorName || 'N/A'],
        ['Date', new Date(session?.startTime || Date.now()).toLocaleDateString()],
        ['Duration (min)', stats?.duration || 'N/A'], ['Total Readings', stats?.count.toString() || '0'],
        ['Result', session?.result || 'IN PROGRESS'],
      ];

      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({ text: 'AGNIPARIKSHA', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'PV Module Reliability Test Report', heading: HeadingLevel.HEADING_2 }),
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
            ...(notes ? [
              new Paragraph(''),
              new Paragraph({ text: 'Notes', heading: HeadingLevel.HEADING_2 }),
              new Paragraph(notes),
            ] : []),
            new Paragraph(''),
            new Paragraph({ children: [new TextRun({ text: `Generated by Agnipariksha on ${new Date().toLocaleString()}`, italics: true, color: '888888', size: 18 })] }),
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `${testName.replace(/\s+/g, '_')}_Report_${Date.now()}.docx`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    setLoading(null);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-4">
        <h3 className="text-sm font-bold text-gray-200">Report Configuration</h3>
        <div className="grid grid-cols-2 gap-3">
          {[{ label: 'Module ID', value: moduleId, set: setModuleId, ph: 'e.g. MOD-2026-001' },
            { label: 'Operator Name', value: operatorName, set: setOperatorName, ph: 'Your name' },
            { label: 'Laboratory', value: labName, set: setLabName, ph: 'Lab name' },
          ].map(f => (
            <div key={f.label}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200" />
            </div>
          ))}
          <div className="col-span-2">
            <label className="text-xs text-gray-400 block mb-1">Additional Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Observations, deviations..."
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 resize-none" />
          </div>
        </div>
      </div>

      {stats && (
        <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
          <h3 className="text-sm font-bold text-gray-200 mb-3">Test Summary</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Avg Voltage', value: stats.avgV.toFixed(3), unit: 'V', color: 'text-blue-400' },
              { label: 'Avg Current', value: stats.avgI.toFixed(3), unit: 'A', color: 'text-green-400' },
              { label: 'Duration', value: stats.duration, unit: 'min', color: 'text-yellow-400' },
            ].map(s => (
              <div key={s.label} className="bg-gray-800 rounded p-2">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-lg font-mono font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500">{s.unit}</p>
              </div>
            ))}
          </div>
          <div className={`mt-3 py-2 text-center rounded font-bold text-sm ${
            session?.result === 'PASS' ? 'bg-green-900/50 text-green-400' :
            session?.result === 'FAIL' ? 'bg-red-900/50 text-red-400' : 'bg-gray-800 text-gray-400'
          }`}>
            {session?.result || 'TEST IN PROGRESS'}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={generatePDF} disabled={loading !== null}
          className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm rounded font-medium transition-colors">
          {loading === 'pdf' ? '⏳ Generating...' : '📄 Export PDF'}
        </button>
        <button onClick={generateWord} disabled={loading !== null}
          className="flex-1 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded font-medium transition-colors">
          {loading === 'word' ? '⏳ Generating...' : '📝 Export Word'}
        </button>
      </div>
    </div>
  );
}
