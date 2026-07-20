import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
    webpackMemoryOptimizations: true,
    webpackBuildWorker: true,
    preloadEntriesOnStart: false,
  },
  transpilePackages: ["@utxopia/sdk"],
  // turbopack: {} is required in Next 16 when a webpack config is also present.
  // Next 16 defaults to Turbopack for builds and errors when it sees a webpack
  // config with no turbopack config at all. An empty object satisfies that check.
  //
  // The webpack block's Node.js built-in fallbacks (fs, path, crypto, etc.) are
  // handled natively by Turbopack — it does not bundle Node built-ins for the
  // browser by default, so no explicit resolveAlias entries are needed here.
  // Symlinks and topLevelAwait are also Turbopack defaults.
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Enable symlinks for bun workspace compatibility
    config.resolve.symlinks = true;
    config.experiments = {
      ...config.experiments,
      topLevelAwait: true,
    };
    if (!isServer) {
      config.output = {
        ...config.output,
        environment: {
          ...config.output?.environment,
          asyncFunction: true,
        },
      };
      // Polyfill Node.js modules for browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        child_process: false,
        crypto: false,
        stream: false,
        os: false,
        net: false,
        tls: false,
        http: false,
        https: false,
        zlib: false,
      };
    }
    return config;
  },
};

export default nextConfig;
