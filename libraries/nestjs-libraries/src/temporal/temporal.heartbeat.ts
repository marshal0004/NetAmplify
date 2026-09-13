// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/temporal/temporal.heartbeat.ts
// NetAmplify — heartbeat shim.
//
// Phase 1 deleted the entire temporal/ directory (Temporal was postiz's
// workflow orchestrator). The 8 kept platform providers import setHeartbeatDetails
// from this path; rather than rewrite each provider, we keep the import surface
// and turn the function into a documented no-op.
//
// Phase 5 will replace this with BullMQ's job.updateProgress() once
// workers are written per docs/03-ARCHITECTURE.md Flow A (Amplify).

export interface HeartbeatDetails {
  [key: string]: unknown;
}

/**
 * No-op heartbeat. In postiz this updated the Temporal workflow's
 * search attributes; in NetAmplify (BullMQ-based) the worker's job
 * progress is reported via `job.updateProgress()`. The providers still
 * call this for now to avoid mass-rewriting; the call has no effect.
 *
 * @deprecated Replaced by BullMQ `job.updateProgress()` in Phase 5.
 */
export async function setHeartbeatDetails(
  _details: HeartbeatDetails
): Promise<void> {
  // Deliberately empty. See file header.
}

/**
 * @deprecated No-op in NetAmplify. Was a Temporal activity context.
 */
export function makeHeartbeatActivity<T>(fn: T): T {
  return fn;
}
