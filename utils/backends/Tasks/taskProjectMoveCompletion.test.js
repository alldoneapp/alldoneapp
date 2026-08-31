const fs = require('fs')
const path = require('path')

const readSource = relativePath => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8')

describe('task project move completion', () => {
    it('keeps the move trace open through source deletion and feed persistence', () => {
        const source = readSource('backends/Tasks/tasksFirestore.js')
        const branch = source.match(
            /export async function setTaskProject\(([\s\S]*?)\n}\n\nexport async function setTaskProjectWithGoal/
        )

        expect(branch).not.toBeNull()
        expect(branch[1]).toMatch(/await awaitWriteAck\(batch\.commit\(\), 'delete task from source project'\)/)
        expect(branch[1]).toMatch(/performanceTrace\.mark\('source_task_deleted'\)/)
        expect(branch[1]).toMatch(/await setTaskProjectFeedsChain\(/)
        expect(branch[1]).toMatch(/performanceTrace\.mark\('feed_chain_committed'\)/)
        expect(branch[1]).toMatch(/const queuedOffline = isAppOffline\(\)/)
        expect(branch[1]).toMatch(/performanceTrace\.end\(queuedOffline \? 'queued_offline' : 'server_acked'/)
        expect(branch[1]).not.toMatch(/\nbatch = new BatchWrapper/)
    })

    it('awaits the feed batch through the offline-aware acknowledgement helper', () => {
        const source = readSource('backends/firestore.js')
        const branch = source.match(
            /export async function setTaskProjectFeedsChain\(([\s\S]*?)\n}\n\n\/\/ The per-object/
        )

        expect(branch).not.toBeNull()
        expect(branch[1]).toMatch(/await awaitWriteAck\(batchFeed\.commit\(\), 'task project feed chain'\)/)
    })

    it('reads moved activity history through the caller access projection', () => {
        const source = readSource('backends/firestore.js')
        const branch = source.match(
            /export async function moveInnerFeedsOnMoveObjectFromProject\(([^]*?)\n}\n\nexport async function setTaskParentGoalMultiple/
        )

        expect(branch).not.toBeNull()
        expect(branch[1]).toMatch(/\.where\('readerIds', 'array-contains', getLoggedUserAccessReaderId\(\)\)/)
        expect(branch[1]).toMatch(/withoutServerAccessProjection\(feedDoc\.data\(\)\)/)
        expect(branch[1]).toMatch(/\{ merge: true \}/)
    })

    it('stamps calendar project moves with durable routing feedback in both task move paths', () => {
        const source = readSource('backends/Tasks/tasksFirestore.js')
        const normalMove = source.match(
            /export async function setTaskProject\((([\s\S]*?))\n}\n\nexport async function setTaskProjectWithGoal/
        )
        const goalMove = source.match(
            /export async function setTaskProjectWithGoal\((([\s\S]*?))\n}\n\nexport async function setTaskParentGoal/
        )

        expect(source).toMatch(/buildCalendarProjectRoutingFeedback\(/)
        expect(normalMove?.[1]).toMatch(/buildManuallyPinnedCalendarData\(/)
        expect(goalMove?.[1]).toMatch(/buildManuallyPinnedCalendarData\(/)
    })

    it('strips access projections from moved root tasks and copied subtasks', () => {
        const source = readSource('backends/Tasks/tasksFirestore.js')

        expect(source).toMatch(/withoutServerAccessProjection\(removeUndefinedForFirestore\(taskCopy\)\)/)
        expect(source).toMatch(/const subTaskToStore = withoutServerAccessProjection\(subTask\)/)
    })

    it('stamps manual calendar Goal additions and removals with durable routing feedback', () => {
        const source = readSource('backends/Tasks/tasksFirestore.js')
        const goalMove = source.match(
            /export async function setTaskProjectWithGoal\((([\s\S]*?))\n}\n\nexport async function setTaskParentGoal/
        )
        const sameProjectGoalChange = source.match(
            /export async function setTaskParentGoal\((([\s\S]*?))\n}\n\nexport async function acceptTaskGoalSuggestion/
        )

        expect(source).toMatch(/buildCalendarGoalRoutingFeedback\(/)
        expect(goalMove?.[1]).toMatch(/buildCalendarDataWithGoalRoutingFeedback\(/)
        expect(sameProjectGoalChange?.[1]).toMatch(/buildCalendarDataWithGoalRoutingFeedback\(/)
        expect(sameProjectGoalChange?.[1]).toMatch(/task\.parentGoalId/)
        expect(sameProjectGoalChange?.[1]).toMatch(/goalId/)
    })
})
