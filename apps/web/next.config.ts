import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Transpile the workspace package consumed as TypeScript source (monorepo).
  transpilePackages: ['@shomee/core'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
    ],
  },
}

export default nextConfig
