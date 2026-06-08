import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

// Sentry build plugin. With `output: 'export'` there's no server to upload
// source maps for; only the client bundle matters. Source map upload runs
// only when SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT are set, so
// `dot deploy` / static builds without those env vars stay clean.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
