import type { NextConfig } from "next";

// Identificador único por build. En Vercel usa el commit SHA del deploy;
// en local, un timestamp. Se hornea en el bundle (NEXT_PUBLIC_BUILD_ID) y lo
// expone /api/version, para detectar cuando hay una versión nueva desplegada.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || `dev-${Date.now()}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  generateBuildId: () => buildId,
};

export default nextConfig;
