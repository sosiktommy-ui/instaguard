import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client', 'bullmq', 'ioredis', 'bcryptjs'],
};

export default nextConfig;
