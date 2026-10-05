import type { NextConfig } from 'next';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

const nextConfig: NextConfig = {
  // Dev split: FE :3001 proxies /api to BE :3000 so lib/api.ts keeps same-origin '' base.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
