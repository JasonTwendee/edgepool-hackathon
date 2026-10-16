import type { NextConfig } from 'next';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

const nextConfig: NextConfig = {
  // Prod image gọn: standalone chỉ copy file trace (~200MB thay vì ~570MB).
  output: 'standalone',
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react', '@solana/web3.js'],
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
