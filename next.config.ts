import type { NextConfig } from "next";

// Identificador único por build. En Vercel usa el commit SHA del deploy;
// en local, un timestamp. Se hornea en el bundle (NEXT_PUBLIC_BUILD_ID) y lo
// expone /api/version, para detectar cuando hay una versión nueva desplegada.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || `dev-${Date.now()}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  generateBuildId: () => buildId,
  // Permite acceder al dev server desde la IP de LAN (probar el mobile del
  // barbero desde un celular en la misma Wi-Fi). Next 16 bloquea con 403 los
  // assets/HMR si el origen no está en esta lista. Solo afecta "next dev".
  allowedDevOrigins: ["192.168.100.16"],
};

export default nextConfig;
