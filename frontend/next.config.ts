import type { NextConfig } from 'next'

const BACKEND_HTTP =
  process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://localhost:8000';

const nextConfig: NextConfig = {
  // Tauri: output static for desktop build
  ...(process.env.TAURI_BUILD === '1' ? { output: 'export' } : {}),
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Proxy server-rendered routes to FastAPI for QR labels + push.
  async rewrites() {
    if (process.env.TAURI_BUILD === '1') return [];
    return [
      { source: '/modules/:id/label', destination: `${BACKEND_HTTP}/modules/:id/label` },
      { source: '/equipment/:id/label', destination: `${BACKEND_HTTP}/equipment/:id/label` },
      { source: '/spare-parts/:id/label', destination: `${BACKEND_HTTP}/spare-parts/:id/label` },
      { source: '/api/push/:path*', destination: `${BACKEND_HTTP}/api/push/:path*` },
      { source: '/api/events/:path*', destination: `${BACKEND_HTTP}/api/events/:path*` },
    ];
  },
}

export default nextConfig
