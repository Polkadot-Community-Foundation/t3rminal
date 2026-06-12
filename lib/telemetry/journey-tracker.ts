/**
 * User-journey tracking on top of Sentry.
 *
 * A "journey" is a multi-step user-perceived flow (e.g. terminal-payment:
 * QR generated → payment detected → sale saved → receipt rendered → done).
 * Each journey emits one parent span with the total duration, plus child
 * "phase" spans per milestone so Sentry shows the waterfall.
 *
 * The exported `journeyTracker` is a module-level singleton so any component
 * or hook can record milestones without prop-drilling the instance.
 */

"use client";

import * as Sentry from "@sentry/nextjs";

// --- App-specific journey catalog ---

export type AppJourneyType =
  | "page-load"
  | "items-checkout"
  | "terminal-payment"
  | "daily-report-save"
  | "daily-report-finalize"
  | "report-decrypt"
  | "bulletin-index-read"
  | "encryption-key-set"
  | "authenticate";

export const APP_JOURNEY_OPS: Record<AppJourneyType, string> = {
  "page-load": "journey.page-load",
  "items-checkout": "journey.items-checkout",
  "terminal-payment": "journey.terminal-payment",
  "daily-report-save": "journey.daily-report-save",
  "daily-report-finalize": "journey.daily-report-finalize",
  "report-decrypt": "journey.report-decrypt",
  "bulletin-index-read": "journey.bulletin-index-read",
  "encryption-key-set": "journey.encryption-key-set",
  authenticate: "journey.authenticate",
};

// --- Generic tracker — do not modify shape; only edit the catalog above. ---

interface ActiveJourney<T> {
  type: T;
  startedAt: number;
  milestones: Map<string, number>;
  attributes: Record<string, string | number | boolean>;
  sad: boolean;
}

export class JourneyTracker<T extends string> {
  private active = new Map<T, ActiveJourney<T>>();
  private spanOps: Record<T, string>;

  constructor(spanOps: Record<T, string>) {
    this.spanOps = spanOps;
  }

  start(
    type: T,
    attributes: Record<string, string | number | boolean> = {},
    startedAt?: number,
  ): void {
    this.active.set(type, {
      type,
      startedAt: startedAt ?? performance.now(),
      milestones: new Map(),
      attributes,
      sad: false,
    });
    console.info(`[Journey:${type}] started`);
  }

  reclassify(from: T, to: T): void {
    const journey = this.active.get(from);
    if (!journey || from === to) return;
    this.active.delete(from);
    journey.type = to;
    this.active.set(to, journey);
    console.info(`[Journey] reclassified ${from} -> ${to}`);
  }

  milestone(type: T, name: string): void {
    const journey = this.active.get(type);
    if (!journey) return;
    if (journey.milestones.has(name)) return;
    const elapsed = performance.now() - journey.startedAt;
    journey.milestones.set(name, elapsed);
    console.info(`[Journey:${type}] ${name} +${elapsed.toFixed(0)}ms`);
  }

  /** Mark an in-flight journey as "sad" (completed but with friction). */
  markSad(type: T): void {
    const journey = this.active.get(type);
    if (journey) journey.sad = true;
  }

  addAttributes(
    type: T,
    attrs: Record<string, string | number | boolean>,
  ): void {
    const journey = this.active.get(type);
    if (!journey) return;
    Object.assign(journey.attributes, attrs);
  }

  complete(type: T): void {
    const journey = this.active.get(type);
    if (!journey) return;
    this.active.delete(type);

    this._emitSpan(journey, type, { code: 1, message: "ok" });
    this._emitPhaseSpans(journey, type);

    const totalMs = performance.now() - journey.startedAt;
    console.info(`[Journey:${type}] completed in ${totalMs.toFixed(0)}ms`);
  }

  fail(type: T, reason?: string): void {
    const journey = this.active.get(type);
    if (!journey) return;
    this.active.delete(type);

    const resolvedReason = reason ?? "unknown";
    journey.sad = true;
    this._emitSpan(
      journey,
      type,
      { code: 2, message: resolvedReason },
      resolvedReason,
    );
    this._emitPhaseSpans(journey, type);

    const totalMs = performance.now() - journey.startedAt;
    console.info(
      `[Journey:${type}] failed after ${totalMs.toFixed(0)}ms: ${reason}`,
    );
  }

  abandon(type: T): void {
    if (this.active.has(type)) {
      console.info(`[Journey:${type}] abandoned`);
      this.active.delete(type);
    }
  }

  isActive(type: T): boolean {
    return this.active.has(type);
  }

  private _emitSpan(
    journey: ActiveJourney<T>,
    type: T,
    status: { code: 0 | 1 | 2; message: string },
    failureReason?: string,
  ): void {
    const totalMs = performance.now() - journey.startedAt;

    const attributes: Record<string, string | number | boolean> = {
      "journey.type": type,
      "journey.duration_ms": Math.round(totalMs),
      "journey.sad": journey.sad ? "true" : "false",
      ...journey.attributes,
    };
    if (failureReason) {
      attributes["journey.failure_reason"] = failureReason;
    }
    for (const [name, elapsed] of journey.milestones) {
      attributes[`journey.milestone.${name}_ms`] = Math.round(elapsed);
    }

    const op = this.spanOps[type];
    const startTime = (performance.timeOrigin + journey.startedAt) / 1000;
    const endTime = (performance.timeOrigin + performance.now()) / 1000;

    const span = Sentry.startSpanManual(
      { name: `journey:${type}`, op, attributes, startTime },
      (s) => s,
    );
    span.setStatus(status);
    span.end(endTime);
  }

  private _emitPhaseSpans(journey: ActiveJourney<T>, type: T): void {
    const op = this.spanOps[type];
    const phaseOp = `${op}.phase`;
    const startTime = (performance.timeOrigin + journey.startedAt) / 1000;
    const milestoneEntries = [...journey.milestones.entries()].sort(
      (a, b) => a[1] - b[1],
    );

    for (const [name, elapsed] of milestoneEntries) {
      const phaseSpan = Sentry.startSpanManual(
        {
          name,
          op: phaseOp,
          attributes: { "journey.type": type },
          startTime,
        },
        (s) => s,
      );
      phaseSpan.setStatus({ code: 1, message: "ok" });
      phaseSpan.end(
        (performance.timeOrigin + journey.startedAt + elapsed) / 1000,
      );
    }
  }
}

export const journeyTracker = new JourneyTracker<AppJourneyType>(
  APP_JOURNEY_OPS,
);
