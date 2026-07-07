import type { NextConfig } from 'next'

// Backend the server-side rewrites proxy to. Read at server start (this file
// runs on the Node server, not in the browser), so it can be a non-public var.
const BACKEND = (
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000'
).replace(/\/+$/, '')

const IS_EXPORT = process.env.TAURI_BUILD === '1'

const nextConfig: NextConfig = {
  // Tauri: output static for desktop build (rewrites are unsupported there,
  // so they are omitted below when exporting).
  ...(IS_EXPORT ? { output: 'export' } : {}),
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Legacy /lid path renamed to /letid per IEC TS 63342. 308 keeps old links working.
  async redirects() {
    return [{ source: '/lid', destination: '/letid', permanent: true }];
  },
  // Same-origin proxy for the backend surfaces the browser calls directly
  // (OPC UA PSU/PV, reliability equipment/inventory). Routing them through
  // the Next server means the browser only ever talks to its own origin — so
  // a single tunnel of :3000 shares the whole working app, and there is no
  // cross-origin/localhost coupling to break.
  ...(IS_EXPORT ? {} : {
    async rewrites() {
      return [
        { source: '/api/opcua/:path*', destination: `${BACKEND}/api/opcua/:path*` },
        { source: '/api/reliability/:path*', destination: `${BACKEND}/api/reliability/:path*` },
      ];
    },
  }),
}

export default nextConfig
