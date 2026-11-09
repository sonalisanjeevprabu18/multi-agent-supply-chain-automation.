/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Keep demonstration screenshots free of the floating dev-tools badge.
  devIndicators: false,
};

export default nextConfig;
