const fs = require('fs')
const path = require('path')

const {
    ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS,
    HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS,
    SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS,
    ASSISTANT_PROMPT_FUNCTION_TIMEOUT_SECONDS,
    HEARTBEAT_FUNCTION_TIMEOUT_SECONDS,
    SCHEDULED_FUNCTION_TIMEOUT_SECONDS,
    transportTimeoutSecondsFor,
} = require('./assistantRunLimits')

// Firestore/Storage/PubSub triggers are delivered through Eventarc, which GCP caps at 540s. Anything
// hosting an assistant run must therefore be invoked over HTTP (onCall/onRequest), via Cloud Tasks
// (onTaskDispatched), or on a schedule (onSchedule) — each with its own ceiling, see below.
const EVENT_TRIGGERS = [
    'onDocumentCreated',
    'onDocumentUpdated',
    'onDocumentDeleted',
    'onDocumentWritten',
    'onObjectFinalized',
    'onMessagePublished',
    'onCustomEventPublished',
]
const EVENT_TRIGGER_MAX_TIMEOUT_SECONDS = 540

// An onSchedule function is an HTTP Cloud Run service, so GCP accepts 3600s on it — but the Cloud
// Scheduler job in front caps its attempt deadline at 1800s and then RETRIES, giving a longer run a
// second concurrent invocation. firebase-tools v15 turned that from a warning into a deploy error.
const SCHEDULE_TRIGGER = 'onSchedule'
const SCHEDULE_TRIGGER_MAX_TIMEOUT_SECONDS = 1800

// Every entry point that hosts a full assistant prompt run, and the wall clock the run is given
// there. Add a function here when it starts executing prompts; the assertions below then hold it to
// a transport that can actually carry that run.
const ASSISTANT_RUN_HOSTS = [
    { name: 'askToBotSecondGen', maxRunWallClockMs: ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS },
    { name: 'generatePreConfigTaskResultSecondGen', maxRunWallClockMs: ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS },
    // Hosts the contact "Enrich profile" research run inside the contact's chat.
    { name: 'enrichContactProfileSecondGen', maxRunWallClockMs: ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS },
    // Deliberately shorter: these execute inline inside an onSchedule function, so they are sized to
    // Cloud Scheduler's attempt deadline rather than to what the function timeout would allow.
    { name: 'checkRecurringAssistantTasks', maxRunWallClockMs: SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS },
    { name: 'runWorkflowAiStepsSecondGen', maxRunWallClockMs: SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS },
    // Deliberately shorter: sized to the Cloud Tasks dispatch ceiling it is delivered through.
    { name: 'runAssistantHeartbeat', maxRunWallClockMs: HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS },
]

// index.js cannot be require()d here (it registers every function and pulls in the whole runtime), so
// the registration is read as source. Each entry is `exports.<name> = <trigger>({ <options> },`.
const readFunctionRegistrations = () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    const registrations = new Map()
    const pattern = /exports\.(\w+)\s*=\s*(\w+)\s*\(\s*\{(.*?)\}\s*,/gs

    let match
    while ((match = pattern.exec(source)) !== null) {
        const [, name, trigger, options] = match
        const timeout = /timeoutSeconds:\s*([\w.]+)/.exec(options)
        registrations.set(name, { trigger, timeoutExpression: timeout ? timeout[1] : null })
    }
    return registrations
}

const RESOLVED_TIMEOUTS = {
    ASSISTANT_PROMPT_FUNCTION_TIMEOUT_SECONDS,
    HEARTBEAT_FUNCTION_TIMEOUT_SECONDS,
    SCHEDULED_FUNCTION_TIMEOUT_SECONDS,
}

const resolveTimeoutSeconds = expression => {
    if (expression === null) return null
    if (expression in RESOLVED_TIMEOUTS) return RESOLVED_TIMEOUTS[expression]
    return Number(expression)
}

describe('assistant run limits', () => {
    it('derives each transport timeout from the wall clock it has to carry', () => {
        expect(ASSISTANT_PROMPT_FUNCTION_TIMEOUT_SECONDS).toBe(
            transportTimeoutSecondsFor(ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS)
        )
        expect(HEARTBEAT_FUNCTION_TIMEOUT_SECONDS).toBe(
            transportTimeoutSecondsFor(HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS)
        )
        expect(SCHEDULED_FUNCTION_TIMEOUT_SECONDS).toBe(
            transportTimeoutSecondsFor(SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS)
        )
    })

    it('keeps every timeout within what its platform actually allows', () => {
        // 3600s is the ceiling for HTTP-invoked functions, 1800s for Cloud Tasks dispatch, and 1800s
        // for Cloud Scheduler's attempt deadline, so a limit raised past any of them would fail to
        // deploy rather than simply run longer.
        expect(ASSISTANT_PROMPT_FUNCTION_TIMEOUT_SECONDS).toBeLessThanOrEqual(3600)
        expect(HEARTBEAT_FUNCTION_TIMEOUT_SECONDS).toBeLessThanOrEqual(1800)
        expect(SCHEDULED_FUNCTION_TIMEOUT_SECONDS).toBeLessThanOrEqual(SCHEDULE_TRIGGER_MAX_TIMEOUT_SECONDS)
    })
})

describe('functions hosting an assistant run', () => {
    const registrations = readFunctionRegistrations()

    const cases = ASSISTANT_RUN_HOSTS.map(host => [host.name, host])

    it.each(cases)('%s is registered', name => {
        expect(registrations.get(name)).toBeDefined()
    })

    it.each(cases)('%s outlives the run it hosts', (name, { maxRunWallClockMs }) => {
        const timeoutSeconds = resolveTimeoutSeconds(registrations.get(name).timeoutExpression)
        expect(timeoutSeconds).toBeGreaterThanOrEqual(transportTimeoutSecondsFor(maxRunWallClockMs))
    })

    it.each(cases)('%s is not behind an event trigger', name => {
        // This is the assertion that would have caught runWorkflowAiStep: an assistant run cannot
        // live inside a 540s Eventarc delivery, and asking for more is rejected at deploy time.
        expect(EVENT_TRIGGERS).not.toContain(registrations.get(name).trigger)
    })
})

describe('every event-triggered function in index.js', () => {
    it('stays within the 540s Eventarc cap, so the deploy cannot be silently rejected', () => {
        const offenders = []
        for (const [name, { trigger, timeoutExpression }] of readFunctionRegistrations()) {
            if (!EVENT_TRIGGERS.includes(trigger)) continue
            const timeoutSeconds = resolveTimeoutSeconds(timeoutExpression)
            if (timeoutSeconds !== null && timeoutSeconds > EVENT_TRIGGER_MAX_TIMEOUT_SECONDS) {
                offenders.push(`${name} (${trigger}, ${timeoutSeconds}s)`)
            }
        }
        expect(offenders).toEqual([])
    })
})

describe('every scheduled function in index.js', () => {
    // The assertion that would have caught the four functions which sat at 3600s in production until
    // a firebase-tools upgrade blocked every deploy to the project. Unlike the Eventarc cap this one
    // is not rejected by GCP at create time — Cloud Scheduler silently caps the attempt deadline and
    // retries instead — so nothing surfaces it except a check like this.
    it('stays within the 1800s Cloud Scheduler attempt deadline, so a long run cannot be retried into a second concurrent invocation', () => {
        const offenders = []
        for (const [name, { trigger, timeoutExpression }] of readFunctionRegistrations()) {
            if (trigger !== SCHEDULE_TRIGGER) continue
            const timeoutSeconds = resolveTimeoutSeconds(timeoutExpression)
            if (timeoutSeconds !== null && timeoutSeconds > SCHEDULE_TRIGGER_MAX_TIMEOUT_SECONDS) {
                offenders.push(`${name} (${trigger}, ${timeoutSeconds}s)`)
            }
        }
        expect(offenders).toEqual([])
    })

    it('covers at least the scheduled functions we know host or dispatch assistant work', () => {
        // Guards the regex above: if readFunctionRegistrations stopped recognising onSchedule
        // registrations, the cap test would pass vacuously.
        const scheduled = [...readFunctionRegistrations()]
            .filter(([, { trigger }]) => trigger === SCHEDULE_TRIGGER)
            .map(([name]) => name)
        expect(scheduled).toEqual(
            expect.arrayContaining([
                'runWorkflowAiStepsSecondGen',
                'checkRecurringAssistantTasks',
                'checkAssistantHeartbeats',
                'reconcileAssistantHeartbeatSchedules',
            ])
        )
    })
})
