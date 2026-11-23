/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",               // required for the desktop/offline bundle
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "nodemailer", "smtp-server", "mailparser"],
    instrumentationHook: true,         // starts the built-in test mailbox (src/instrumentation.ts)
  },
  poweredByHeader: false,
};
export default nextConfig;
