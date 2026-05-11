import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agnipariksha — PV Reliability Test Station',
  description:
    'Shreshtata Power Supplies · ITECH PV6000 controller for IEC 61215 / 61730 / 62979 / TS 63342 reliability testing.',
  applicationName: 'Agnipariksha',
};

export const viewport: Viewport = {
  themeColor: '#0b0f14',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-panel text-steel-100 antialiased">{children}</body>
    </html>
  );
}
