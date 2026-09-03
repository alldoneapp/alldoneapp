const fs = require('fs')
const path = require('path')

// A callable that hosts a full assistant prompt run is not idempotent by itself, and its response is
// the one most likely to be lost: the run takes tens of seconds, so a laptop that sleeps mid-request
// (AT: lid closed 16s after the POST, machine woken 4m35s later) makes the browser retransmit the
// identical request. Without a per-message lock that replay runs the whole prompt again — a second
// answer in the thread and a second Gold charge from one user action. `askToBotSecondGen` was
// guarded; `generatePreConfigTaskResultSecondGen` was not, which is the bug this file ratchets shut.
//
// Both callables already receive the client-generated `messageId` of the comment that triggered the
// run, which is exactly the idempotency key `acquireAssistantRunLock` wants.
const RUN_LOCK_HOSTS = ['askToBotSecondGen', 'generatePreConfigTaskResultSecondGen']

// index.js cannot be require()d here (it registers every function and pulls in the whole runtime), so
// the registration is read as source — same approach as assistantRunLimits.test.js.
const readSource = () => fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

const readRegistrationBody = (source, name) => {
    const start = source.indexOf(`exports.${name} = `)
    if (start === -1) return null
    const next = source.indexOf('\nexports.', start + 1)
    return source.slice(start, next === -1 ? source.length : next)
}

describe('assistant prompt callables are protected against a replayed request', () => {
    const source = readSource()

    describe.each(RUN_LOCK_HOSTS)('%s', name => {
        const body = readRegistrationBody(source, name)

        test('is registered in index.js', () => {
            expect(body).toBeTruthy()
        })

        test('acquires the per-message run lock keyed on the triggering messageId', () => {
            expect(body).toContain('acquireAssistantRunLock(')

            const acquireCall = body.slice(
                body.indexOf('acquireAssistantRunLock(admin.firestore(), {'),
                body.indexOf('acquireAssistantRunLock(admin.firestore(), {') + 400
            )
            // Without messageId the lock helper deliberately no-ops (`acquired: true`, no lockRef),
            // so passing project/object alone would look wired up and protect nothing.
            expect(acquireCall).toContain('messageId,')
            expect(acquireCall).toContain('projectId,')
            expect(acquireCall).toContain('objectType,')
        })

        test('returns early on a duplicate instead of running the prompt again', () => {
            const guardIndex = body.indexOf('if (!assistantRunLock.acquired)')
            expect(guardIndex).toBeGreaterThan(-1)

            const guardBlock = body.slice(guardIndex, body.indexOf('\n            }\n', guardIndex))
            expect(guardBlock).toContain('duplicate: true')
            expect(guardBlock).toContain('return')

            // The guard has to sit between acquiring the lock and invoking the run, or the duplicate
            // pays for the prompt before deciding it was a duplicate.
            expect(guardIndex).toBeGreaterThan(body.indexOf('acquireAssistantRunLock('))
        })

        test('settles the lock on both the success and the failure path', () => {
            // A lock left `running` holds the coarse per-task slot for its 65-minute lease, which
            // blocks workflow AI steps on that task and makes a legitimate retry look like a
            // duplicate.
            expect(body).toContain('completeAssistantRunLock(assistantRunLock.lockRef)')
            expect(body).toContain('failAssistantRunLock(assistantRunLock.lockRef, error)')
        })
    })
})
