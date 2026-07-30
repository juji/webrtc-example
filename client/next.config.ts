import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  allowedDevOrigins: ["webrtc-client.jujitest.com"],
};

export default nextConfig;
