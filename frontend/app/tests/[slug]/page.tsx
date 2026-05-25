import { notFound, redirect } from 'next/navigation';

// Map URL-friendly test slugs to the tab keys used by the legacy /dashboard.
const SLUG_TO_TAB: Record<string, string> = {
  'thermal-cycling':   'tc',
  'humidity-freeze':   'hf',
  'damp-heat':         'dh',
  'bypass-diode':      'bdt',
  'pid':               'pid',
  'letid':             'letid',
  'reverse-current':   'rco',
  'ground-continuity': 'gct',
  'equipotential-bonding': 'eb',
};

export function generateStaticParams(): Array<{ slug: string }> {
  return Object.keys(SLUG_TO_TAB).map(slug => ({ slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function TestRedirectPage({ params }: PageProps): Promise<never> {
  const { slug } = await params;
  const tab = SLUG_TO_TAB[slug];
  if (!tab) notFound();
  redirect(`/dashboard?tab=${tab}`);
}
