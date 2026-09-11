/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Neon driver and ethers run in the Node runtime on API routes.
  serverExternalPackages: ['@neondatabase/serverless', 'ethers', '@privy-io/server-auth'],
};

export default nextConfig;
