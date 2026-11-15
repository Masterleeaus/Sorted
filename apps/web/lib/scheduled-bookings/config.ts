import { MIN_ROUTE_SECRET_LENGTH } from "./envelope";

/**
 * Scheduled booking event consumer configuration. Read from the environment at
 * call time. Nothing is baked into the repository. The route is off unless
 * SCHEDULED_BOOKING_EVENTS_ENABLED is exactly "1".
 *
 *   SCHEDULED_BOOKING_EVENTS_ENABLED        "1" turns the route on. Default off.
 *   SCHEDULED_BOOKING_EVENTS_SECRET         route secret (>= 32 chars, secret store only)
 *   SCHEDULED_BOOKING_EVENTS_ORGANISATION_ID  Central organisation bound to this route (UUID)
 *   SCHEDULED_BOOKING_EVENTS_ACTOR_USER_ID  Sorted user recorded as jobs.created_by (UUID)
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ScheduledBookingConfig =
  | { enabled: false }
  | {
      enabled: true;
      secret: string;
      organisationId: string;
      actorUserId: string;
    };

export class ScheduledBookingConfigError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Scheduled booking events are misconfigured: ${variable}`);
    this.name = "ScheduledBookingConfigError";
    this.variable = variable;
  }
}

export function readScheduledBookingConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ScheduledBookingConfig {
  if (env.SCHEDULED_BOOKING_EVENTS_ENABLED !== "1") return { enabled: false };

  const secret = (env.SCHEDULED_BOOKING_EVENTS_SECRET ?? "").trim();
  if (secret.length < MIN_ROUTE_SECRET_LENGTH) {
    throw new ScheduledBookingConfigError("SCHEDULED_BOOKING_EVENTS_SECRET");
  }
  const organisationId = (env.SCHEDULED_BOOKING_EVENTS_ORGANISATION_ID ?? "").trim();
  if (!UUID_RE.test(organisationId)) {
    throw new ScheduledBookingConfigError("SCHEDULED_BOOKING_EVENTS_ORGANISATION_ID");
  }
  const actorUserId = (env.SCHEDULED_BOOKING_EVENTS_ACTOR_USER_ID ?? "").trim();
  if (!UUID_RE.test(actorUserId)) {
    throw new ScheduledBookingConfigError("SCHEDULED_BOOKING_EVENTS_ACTOR_USER_ID");
  }
  return { enabled: true, secret, organisationId, actorUserId };
}
