/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Mark pdfjs-dist as a server external package — Next.js won't bundle it
  // and will instead resolve it from node_modules at runtime. This avoids
  // the "Cannot find module pdf.worker.mjs" error on Vercel.
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

module.exports = nextConfig;
