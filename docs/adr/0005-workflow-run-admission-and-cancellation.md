# 5. Bounded Workflow Run Admission and Cancellation

We supervise Trigger deliveries at the Workflow activation seam instead of
calling the Pipeline executor directly from a Trigger callback. Every active
Workflow activation owns one run supervisor.

## Status

Accepted

## Default policy

- Runs are admitted serially (`concurrency = 1`).
- At most 16 Events may wait behind the active run.
- When the queue is full, the newest Event is dropped.
- Admission is per Workflow activation, so one noisy Workflow cannot create
  overlapping runs or consume another Workflow's queue.

The supervisor publishes `workflow.queued` and `workflow.dropped` Events with
the Workflow, Pipeline, run identity, queue size, and policy. A run receives a
stable `runId`; started and terminal execution Events carry that identity.

## Lifecycle behavior

Disable, update, delete, and shutdown stop admission immediately. Queued runs
are cancelled and published as cancelled. The active run receives an
Engine-owned `AbortSignal`; built-in cancellable operations such as `delay`
stop promptly, while an adapter that cannot cancel is allowed to finish and is
reported as cancelled before the supervisor becomes idle.

Update and delete wait for the old activation's supervisor to become idle
before saving a replacement or removing the stored Workflow. Shutdown cancels
active runs through `stopRuns(...)/supervisor.cancel(reason)` and then waits for
the supervisor's `waitForIdle()` synchronization point before closing Engine
resources. It does not drain admitted work; it shares only the idle wait with
drain().

The Pipeline executor reports explicit `succeeded`, `failed`, and `cancelled`
outcomes. A failed run is completed with a failed outcome, not presented as a
successful completion.

## Consequences

The default favors predictable Workflow State and bounded resource use over
maximum throughput. Parallel execution remains available to the supervisor's
interface for a later, explicit policy decision; it is not enabled by default.
