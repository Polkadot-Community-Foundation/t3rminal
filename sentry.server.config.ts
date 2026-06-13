/**
 * Sentry server-side init. With `output: 'export'` we don't ship a Node
 * server, but the file is required by `@sentry/nextjs`. Production deploys
 * never execute this.
 */

import * as Sentry from "@sentry/nextjs";

import { commonInitOptions } from "@/lib/telemetry/sentry-init";

Sentry.init(commonInitOptions());
