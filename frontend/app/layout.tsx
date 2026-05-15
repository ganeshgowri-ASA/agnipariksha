import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';

export const metadata: Metadata = {
  title: 'Agnipariksha — PV Reliability Test Station',
  description: 'ITECH PV6000 DC Power Supply Controller for PV Module Reliability Testing',
};

// Run before hydration to set the .dark class from localStorage / system
// preference, preventing the white-flash on first paint.
const NO_FLASH = `
(function(){
  try {
    var s = localStorage.getItem('agni-theme');
    var t = (s === 'light' || s === 'dark')
      ? s
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var r = document.documentElement;
    if (t === 'dark') r.classList.add('dark'); else r.classList.remove('dark');
    r.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="bg-app text-app antialiased">
        <ThemeProvider>
          {children}
          <KeyboardShortcuts />
        </ThemeProvider>
      </body>
    </html>
  );
}
