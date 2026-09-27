import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Match Webflow's URLs exactly: /menu, not /menu/.
  trailingSlash: false,
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/wf/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
