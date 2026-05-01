import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@ankify/core", "@ankify/db"],
};

export default config;
