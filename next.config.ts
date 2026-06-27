import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Не бандлить серверные пакеты (bullmq тянет 'crypto' из bun-redis-client и ломал dev-сборку)
  serverExternalPackages: ['bullmq', 'ioredis', 'bcryptjs'],
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
