'use client';

import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  /** Test identifier, e.g. "bdt", "gct", "tc". */
  testCode: string;
  /** Optional mode/variant, e.g. "pulse" for BDT or "chamber" for TC. */
  mode?: string;
}

type Status = 'idle' | 'loading' | 'ready' | 'missing';

/**
 * Collapsible wiring-diagram preview for a single test mode. Inlines the
 * matching SVG from /assets/schematics so the markup is real DOM (themeable,
 * testable) rather than an opaque <img>. Shows a placeholder when the asset
 * is absent.
 */
export default function SchematicViewer({ testCode, mode }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [markup, setMarkup] = useState<string | null>(null);

  const file = mode ? `${testCode}-${mode}.svg` : `${testCode}.svg`;
  const src = `/assets/schematics/${file}`;

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (!next || status !== 'idle') return;
    setStatus('loading');
    void fetch(src)
      .then(async (res) => {
        const text = await res.text();
        if (res.ok && text.trimStart().startsWith('<svg')) {
          setMarkup(text);
          setStatus('ready');
        } else {
          setStatus('missing');
        }
      })
      .catch(() => setStatus('missing'));
  }, [open, status, src]);

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700" data-testid="schematic-viewer">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid="schematic-toggle"
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-gray-300 hover:text-white"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {open ? 'Hide wiring diagram' : 'Show wiring diagram'}
      </button>
      {open && (
        <div className="px-4 pb-4" data-testid="schematic-body">
          {status === 'loading' && <p className="text-xs text-gray-500">Loading diagram…</p>}
          {status === 'missing' && (
            <p className="text-xs italic text-gray-500" data-testid="schematic-missing">
              Schematic not yet available
            </p>
          )}
          {status === 'ready' && markup && (
            <div
              data-testid="schematic-svg"
              className="rounded bg-white/5 p-3 [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-xl"
              dangerouslySetInnerHTML={{ __html: markup }}
            />
          )}
        </div>
      )}
    </div>
  );
}
