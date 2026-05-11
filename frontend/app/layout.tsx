import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agnipariksha — PV Reliability Test Station',
  description: 'ITECH PV6000 DC Power Supply Controller for PV Module Reliability Testing',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
