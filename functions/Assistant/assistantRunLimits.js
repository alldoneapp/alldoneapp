// Single source of truth for how long one assistant prompt run may take, and for the function
// timeout the entry point hosting that run must therefore be given.
//
// These two numbers have to move together. An entry point whose transport dies before the run's own
// wall clock expires kills the assistant mid-answer, and the caller cannot tell that apart from a
// crash. That mismatch is not hypothetical: runWorkflowAiStep asked for the full 55-minute run below
// while sitting behind an onDocumentCreated trigger, which GCP caps at 540s — so the function could
// not even be created, and workflow AI runs piled up unexecuted in production.
//
// Deriving the timeout from the wall clock (rather than hardcoding both) is what keeps the pair
// honest; assistantRunLimits.test.js asserts every entry point actually honours it.

// A full assistant prompt run: chat/preconfig-task answers, and workflow AI steps.
const ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS = 55 * 60 * 1000

// Heartbeats deliberately run shorter. They fire unattended on a schedule and are dispatched through
// Cloud Tasks, whose HTTP dispatch deadline tops out at 30 minutes, so the run is sized to fit that
// transport instead of the other way around.
const HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS = 25 * 60 * 1000

// Context assembly happens before the run and result posting after it, so the transport has to
// outlive the run itself.
const TRANSPORT_HEADROOM_MS = 5 * 60 * 1000

const transportTimeoutSecondsFor = maxRunWallClockMs => (maxRunWallClockMs + TRANSPORT_HEADROOM_MS) / 1000

// 3600s — also the ceiling for HTTP-invoked functions (onCall/onRequest/onSchedule). Event-triggered
// functions cap at 540s and so cannot host a full assistant run at all.
const ASSISTANT_PROMPT_FUNCTION_TIMEOUT_SECONDS = transportTimeoutSecondsFor(ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS)

// 1800s — also the Cloud Tasks dispatch ceiling, which is what sized the heartbeat run above.
const HEARTBEAT_FUNCTION_TIMEOUT_SECONDS = transportTimeoutSecondsFor(HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS)

module.exports = {
    ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS,
    HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS,
    TRANSPORT_HEADROOM_MS,
    transportTimeoutSecondsFor,
    ASSISTANT_PROMPT_FUNCTION_TIMEOUT_SECONDS,
    HEARTBEAT_FUNCTION_TIMEOUT_SECONDS,
}
