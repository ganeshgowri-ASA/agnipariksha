import Link from 'next/link';
import { Printer, ScanLine } from 'lucide-react';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ModuleDetailPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id } = await params;
  return <ResourceDetail kind="module" id={id} labelHref={`/modules/${encodeURIComponent(id)}/label`} />;
}

function ResourceDetail({ kind, id, labelHref }: { kind: string; id: string; labelHref: string }) {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-bold capitalize">{kind} · <span className="font-mono text-orange-300">{id}</span></h1>
        <p className="text-sm text-gray-400">
          Scanned from /scan. Print the QR label to attach to the {kind}, or jump back to the dashboard.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={labelHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded bg-blue-700/70 px-3 py-2 text-xs font-semibold text-blue-50 hover:bg-blue-700"
          >
            <Printer className="h-4 w-4" /> Open printable label (PDF)
          </a>
          <Link
            href="/scan"
            className="inline-flex items-center gap-1.5 rounded border border-gray-700 px-3 py-2 text-xs hover:bg-gray-800"
          >
            <ScanLine className="h-4 w-4" /> Scan another
          </Link>
          <Link href="/" className="rounded border border-gray-700 px-3 py-2 text-xs hover:bg-gray-800">
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
