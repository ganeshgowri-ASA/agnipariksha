import { notFound, redirect } from 'next/navigation';

// Map URL-friendly test slugs to the tab keys used by app/page.tsx.
// "letid" is handled by its own dedicated route (app/tests/letid/page.tsx)
// and is intentionally excluded here.
const SLUG_TO_TAB: Record<string, string> = {
  'thermal-cycling':   'tc',
  'humidity-freeze':   'hf',
  'damp-heat':         'dh',
  'bypass-diode':      'bdt',
  'pid':               'letid',
  'reverse-current':   'rco',
  'ground-continuity': 'gct',
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
  redirect(`/?tab=${tab}`);
}
