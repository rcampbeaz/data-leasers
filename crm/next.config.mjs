/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Media uploads go through a server action. The default limit is 1 MB, which rules out
    // every video and most photographs straight off a phone.
    serverActions: { bodySizeLimit: '30mb' },
  },
};

export default nextConfig;
