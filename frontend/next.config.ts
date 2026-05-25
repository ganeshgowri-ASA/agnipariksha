import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Tauri: output static for desktop build
  ...(process.env.TAURI_BUILD === '1' ? { output: 'export' } : {}),
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Legacy /lid path renamed to /letid per IEC TS 63342. 308 keeps old links working.
  async redirects() {
    return [{ source: '/lid', destination: '/letid', permanent: true }];
  },
}

export default nextConfig
