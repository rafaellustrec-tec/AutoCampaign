import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';
const config: NextConfig = {
  output: process.env.VERCEL === '1' ? undefined : 'standalone',
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  enablePrerenderSourceMaps: false,
  // The build launcher runs tsc successfully before setting this flag for Next.
  typescript: { ignoreBuildErrors: process.env.AGENCY_BUILD_TYPECHECKED === '1' },
  serverExternalPackages: ['pg', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', 'pdf-lib'],
  experimental: {
    cpus: 1,
    memoryBasedWorkersCount: false,
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
    parallelServerCompiles: false,
    parallelServerBuildTraces: false,
    serverSourceMaps: false,
  },
  turbopack: {},
  webpack(config, { dev }) {
    if (!dev) config.cache = false;
    return config;
  },
  async headers() { return [{ source: '/:path*', headers: [{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'},{key:'X-Frame-Options',value:'DENY'}] }]; },
};
export default withWorkflow(config);
