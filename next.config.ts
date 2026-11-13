import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The Operations review page became the manager dashboard; keep old links
    // (README screenshots, bookmarks, the previous smoke scripts) working.
    return [
      {
        source: '/manager/operations-review',
        destination: '/manager/dashboard',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    const apiBaseUrl = (
      process.env.API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      'http://localhost:3001'
    ).replace(/\/+$/, '');

    return [
      {
        source: '/api/:path*',
        destination: `${apiBaseUrl}/api/:path*`,
      },
    ];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
