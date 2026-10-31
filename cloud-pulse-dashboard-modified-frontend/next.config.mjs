/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    VITE_API_BASE_URL: process.env.VITE_API_BASE_URL,
  },
}

export default nextConfig

