import {
    ROUTING_ACTIVITY_CONFIRMED,
    ROUTING_ACTIVITY_PROCESSING,
    ROUTING_CONFIRMATION_WINDOW_MS,
    ROUTING_SUBJECT_GOAL,
    ROUTING_SUBJECT_PROJECT,
    getTaskRoutingActivity,
    getTaskRoutingConfirmation,
    getTaskRoutingProcessing,
} from './taskRoutingActivity'

/**
 * AT-2381. These assertions are written against the field shapes the two Cloud Functions
 * actually write (`functions/Tasks/taskProjectRouting.js`, `functions/Tasks/taskGoalRouting.js`),
 * not against an idealised contract — the statuses, the settle-before-move ordering and the
 * two conflicting meanings of `'pending'` are all load-bearing.
 */

const NOW = 1_700_000_000_000
const HOST = 'project-host'
const TARGET = 'project-target'

const task = overrides => ({ id: 'task-1', parentGoalId: null, ...overrides })

describe('getTaskRoutingProcessing', () => {
    it('sparkles while the project router has not picked the task up yet', () => {
        // 'pending' here is stamped CLIENT-side at creation (utils/automaticProjectRouting.js).
        // The user is already waiting at this point, so it must sparkle before the server claims it.
        expect(getTaskRoutingProcessing(task({ projectRouting: { status: 'pending' } }))).toEqual({
            subject: ROUTING_SUBJECT_PROJECT,
        })
    })

    it('sparkles while the project router is classifying', () => {
        expect(getTaskRoutingProcessing(task({ projectRouting: { status: 'classifying' } }))).toEqual({
            subject: ROUTING_SUBJECT_PROJECT,
        })
    })

    it('sparkles while the goal router is classifying', () => {
        expect(getTaskRoutingProcessing(task({ goalSuggestion: { status: 'classifying' } }))).toEqual({
            subject: ROUTING_SUBJECT_GOAL,
        })
    })

    it('does NOT sparkle for a settled goal suggestion waiting on the user', () => {
        // The trap: goalSuggestion 'pending' means "settled, awaiting the USER" — the exact
        // opposite of projectRouting 'pending'. Treating the two vocabularies as one would leave
        // a permanent sparkle on every task carrying an un-actioned suggestion.
        expect(getTaskRoutingProcessing(task({ goalSuggestion: { status: 'pending', goalId: 'g1' } }))).toBeNull()
    })

    it.each(['routed', 'kept', 'failed'])('stops sparkling once project routing settles as %s', status => {
        expect(getTaskRoutingProcessing(task({ projectRouting: { status } }))).toBeNull()
    })

    it('reports the project router first while both could be in flight', () => {
        const both = task({
            projectRouting: { status: 'classifying' },
            goalSuggestion: { status: 'classifying' },
        })
        expect(getTaskRoutingProcessing(both).subject).toBe(ROUTING_SUBJECT_PROJECT)
    })

    it('says nothing about a task that was never routed', () => {
        expect(getTaskRoutingProcessing(task({}))).toBeNull()
        expect(getTaskRoutingProcessing(null)).toBeNull()
    })
})

describe('getTaskRoutingConfirmation — project move', () => {
    const movedTask = (overrides = {}) =>
        task({
            projectRouting: {
                status: 'routed',
                resolvedAt: NOW - 1000,
                movedFromProjectId: HOST,
                chosenProjectId: TARGET,
                ...overrides,
            },
        })

    it('confirms in the project the task was moved INTO', () => {
        const confirmation = getTaskRoutingConfirmation(movedTask(), TARGET, NOW)

        expect(confirmation).toMatchObject({ subject: ROUTING_SUBJECT_PROJECT, fromProjectId: HOST })
    })

    it('stays silent in the project the task was moved OUT of', () => {
        // The router settles to 'routed' BEFORE the move, so for a moment the source document
        // carries this exact payload. It must not announce a move to a list it is leaving.
        expect(getTaskRoutingConfirmation(movedTask(), HOST, NOW)).toBeNull()
    })

    it('stays silent when the move itself failed after the status was settled', () => {
        // taskProjectRouting.js:380-388 — the move throws, the doc keeps `status: 'routed'` and
        // `movedFromProjectId` naming the project the task never actually left. Comparing the two
        // is the only thing standing between that and a false "Moved to …".
        const stranded = movedTask({ movedFromProjectId: HOST })
        expect(getTaskRoutingConfirmation(stranded, HOST, NOW)).toBeNull()
    })

    it('does not celebrate a decision to keep the task where it is', () => {
        const kept = task({ projectRouting: { status: 'kept', resolvedAt: NOW - 1000, movedFromProjectId: null } })
        expect(getTaskRoutingConfirmation(kept, HOST, NOW)).toBeNull()
    })

    it('does not celebrate a failed classification', () => {
        const failed = task({
            projectRouting: { status: 'failed', reason: 'insufficient_gold', resolvedAt: NOW - 1000 },
        })
        expect(getTaskRoutingConfirmation(failed, HOST, NOW)).toBeNull()
    })

    it('expires so a reload days later does not replay old moves', () => {
        const stale = movedTask({ resolvedAt: NOW - ROUTING_CONFIRMATION_WINDOW_MS - 1 })
        expect(getTaskRoutingConfirmation(stale, TARGET, NOW)).toBeNull()
    })

    it('tolerates a server clock that ran ahead of the browser', () => {
        // resolvedAt is the FUNCTION's Date.now(), compared against the BROWSER's. Skew in this
        // direction must not discard the confirmations that just happened.
        const skewed = movedTask({ resolvedAt: NOW + 5000 })
        expect(getTaskRoutingConfirmation(skewed, TARGET, NOW)).not.toBeNull()
    })

    it('ignores a routing map with no resolvedAt at all', () => {
        expect(getTaskRoutingConfirmation(movedTask({ resolvedAt: undefined }), TARGET, NOW)).toBeNull()
    })
})

describe('getTaskRoutingConfirmation — goal auto-assign', () => {
    const assigned = () =>
        task({
            parentGoalId: 'goal-1',
            goalSuggestion: { status: 'auto_assigned', goalId: 'goal-1', resolvedAt: NOW - 500 },
        })

    it('confirms a goal the router attached by itself', () => {
        expect(getTaskRoutingConfirmation(assigned(), HOST, NOW)).toMatchObject({
            subject: ROUTING_SUBJECT_GOAL,
            goalId: 'goal-1',
        })
    })

    it('does not confirm a suggestion the user still has to accept', () => {
        const suggested = task({ goalSuggestion: { status: 'pending', goalId: 'goal-1', resolvedAt: NOW - 500 } })
        expect(getTaskRoutingConfirmation(suggested, HOST, NOW)).toBeNull()
    })

    it('goes quiet once the auto-assigned goal has been undone', () => {
        // parentGoalId and goalSuggestion are written in ONE transaction, so disagreement means
        // the assignment was reversed since — by Undo, by the user, or by a later project move
        // nulling parentGoalId. Same test autoAssignedGoalGuard uses to recognise a live assign.
        const undone = task({
            parentGoalId: null,
            goalSuggestion: { status: 'auto_assigned', goalId: 'goal-1', resolvedAt: NOW - 500 },
        })
        expect(getTaskRoutingConfirmation(undone, HOST, NOW)).toBeNull()
    })

    it('goes quiet once the user moved the task to a different goal', () => {
        const reassigned = task({
            parentGoalId: 'goal-2',
            goalSuggestion: { status: 'auto_assigned', goalId: 'goal-1', resolvedAt: NOW - 500 },
        })
        expect(getTaskRoutingConfirmation(reassigned, HOST, NOW)).toBeNull()
    })
})

describe('signatures', () => {
    it('distinguishes two different decisions on the same task', () => {
        const first = getTaskRoutingConfirmation(
            task({ projectRouting: { status: 'routed', resolvedAt: NOW - 10, movedFromProjectId: HOST } }),
            TARGET,
            NOW
        )
        const second = getTaskRoutingConfirmation(
            task({ projectRouting: { status: 'routed', resolvedAt: NOW - 5, movedFromProjectId: HOST } }),
            TARGET,
            NOW
        )

        expect(first.signature).not.toBe(second.signature)
    })

    it('is stable across re-derivations of the same decision, so the latch can dedupe it', () => {
        const moved = task({ projectRouting: { status: 'routed', resolvedAt: NOW - 10, movedFromProjectId: HOST } })

        expect(getTaskRoutingConfirmation(moved, TARGET, NOW).signature).toBe(
            getTaskRoutingConfirmation(moved, TARGET, NOW + 250).signature
        )
    })
})

describe('contract with the pieces either side', () => {
    it('recognises the exact stamp the create popup writes', () => {
        // The real builder, not a hand-written fixture. AT-2342's optimistic create publishes the
        // raw document straight to the list watchers, so this stamp is what the row sees BEFORE
        // any server round trip — which is precisely when the user most needs to see the sparkle.
        const { buildPendingProjectRouting } = require('./automaticProjectRouting')
        const stamped = task({ projectRouting: buildPendingProjectRouting({ hostProjectId: HOST, now: NOW }) })

        expect(getTaskRoutingProcessing(stamped)).toEqual({ subject: ROUTING_SUBJECT_PROJECT })
    })

    it('keeps projectRouting on the task shape mapTaskData produces', () => {
        // `mapTaskData` is the one place every task enters the app, and it is an ALLOWLIST: a
        // field it does not name is dropped, silently. `projectRouting` was write-only before
        // AT-2381 — stamped at create time and never read back — so without this line every row
        // would see `undefined` no matter what the router wrote, and the sparkle would simply
        // never appear.
        //
        // Asserted against the source rather than by calling it: `utils/backends/firestore.js`
        // transitively imports the redux store, the whole settings tree and
        // react-native-gesture-handler, so importing it from a unit test costs more setup than
        // the assertion is worth. Same guardrail convention as
        // `__tests__/PopupSafeAreaGuardrails.test.js` and `__tests__/ModalSystemGuardrails.test.js`.
        const source = require('fs').readFileSync(require('path').join(__dirname, 'backends/firestore.js'), 'utf8')
        const mapTaskDataBody = source.slice(source.indexOf('export function mapTaskData'))

        expect(mapTaskDataBody).toMatch(/projectRouting: task\.projectRouting/)
    })
})

describe('getTaskRoutingActivity', () => {
    it('prefers the confirmation when a just-moved task is already being goal-classified', () => {
        // Real sequence: the task lands in its new project, onCreateTask fires there, and the goal
        // router claims it. "It just arrived here" is the more useful thing to say first.
        const justArrived = task({
            projectRouting: { status: 'routed', resolvedAt: NOW - 200, movedFromProjectId: HOST },
            goalSuggestion: { status: 'classifying' },
        })

        expect(getTaskRoutingActivity(justArrived, TARGET, NOW)).toMatchObject({
            kind: ROUTING_ACTIVITY_CONFIRMED,
            subject: ROUTING_SUBJECT_PROJECT,
        })
    })

    it('falls back to processing when there is nothing to confirm', () => {
        expect(getTaskRoutingActivity(task({ goalSuggestion: { status: 'classifying' } }), HOST, NOW)).toMatchObject({
            kind: ROUTING_ACTIVITY_PROCESSING,
            subject: ROUTING_SUBJECT_GOAL,
        })
    })

    it('is null for an ordinary task, which is the overwhelmingly common case', () => {
        expect(getTaskRoutingActivity(task({}), HOST, NOW)).toBeNull()
    })
})
