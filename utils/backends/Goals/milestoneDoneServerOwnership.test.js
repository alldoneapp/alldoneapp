const fs = require('fs')
const path = require('path')

const goalsSource = fs.readFileSync(path.join(__dirname, 'goalsFirestore.js'), 'utf8')
const doneStateSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'components', 'GoalsView', 'DoneStateWrapper.js'),
    'utf8'
)

describe('server-owned milestone transitions', () => {
    it('sends only the milestone target state and performs no browser-side goal batch', () => {
        const start = goalsSource.indexOf('export async function updateMilestoneDoneState')
        const end = goalsSource.indexOf('\n}', start) + 2
        const branch = goalsSource.slice(start, end)

        expect(branch).toContain("runHttpsCallableFunction('updateMilestoneDoneStateSecondGen'")
        expect(branch).toContain('milestoneId: milestone.id')
        expect(branch).toContain('targetDone: !milestone.done')
        expect(branch).not.toContain('BatchWrapper')
        expect(branch).not.toContain('updateGoalData')
    })

    it('awaits the transition and restores checkbox state after a visible failure', () => {
        expect(doneStateSource).toContain('await Backend.updateMilestoneDoneState(projectId, milestone)')
        expect(doneStateSource).toContain("console.error('[Milestone transition] Could not mark milestone as done'")
        expect(doneStateSource).toContain('setChecked(milestone.done)')
    })
})
