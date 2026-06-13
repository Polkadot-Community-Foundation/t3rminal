/**
 * Sentry edge-runtime init. Kept so the Next.js + Sentry build plugin doesn't
 * complain. We don't ship edge routes.
 */

import * as Sentry from "@sentry/nextjs";

import { commonInitOptions } from "@/lib/telemetry/sentry-init";

Sentry.init(commonInitOptions());
