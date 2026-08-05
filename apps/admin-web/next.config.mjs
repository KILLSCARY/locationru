/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle under .next/standalone, so the production
  // Docker image only needs that output plus .next/static — not the full
  // node_modules tree or devDependencies.
  output: 'standalone',
};

export default nextConfig;
