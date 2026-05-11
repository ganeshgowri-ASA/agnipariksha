import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Tauri: output static for desktop build
  ...(process.env.TAURI_BUILD === '1' ? { output: 'export' } : {}),
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
