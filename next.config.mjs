/** @type {import('next').NextConfig} */
const gatewayPrefix = normalizeGatewayPrefix(process.env.NEXT_PUBLIC_GATEWAY_PREFIX);

const nextConfig = gatewayPrefix
  ? {
      // The platform gateway strips this prefix before forwarding the request to
      // Next.js.  Therefore this must be an assetPrefix rather than basePath.
      assetPrefix: gatewayPrefix,
    }
  : {};

function normalizeGatewayPrefix(value) {
  if (!value || value === "/") {
    return "";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

export default nextConfig;
