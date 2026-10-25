const fs = require('fs')
const path = require('path')

const usersSource = fs.readFileSync(path.join(__dirname, 'usersFirestore.js'), 'utf8')
const popupSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'components', 'UIComponents', 'ConfirmPopup.js'),
    'utf8'
)

describe('server-owned account deletion', () => {
    it('does not perform permission-sensitive Firestore cleanup in the browser', () => {
        const start = usersSource.indexOf('export async function deleteUser(user)')
        const end = usersSource.indexOf('\nexport ', start + 1)
        const branch = usersSource.slice(start, end)

        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
        expect(branch).toContain(
            "await runHttpsCallableFunction('deleteUserSecondGen', { userId }, { timeout: 540000 })"
        )
        expect(branch).not.toContain('getAllUserProjects')
        expect(branch).not.toContain('new BatchWrapper')
        expect(
            branch.indexOf("await runHttpsCallableFunction('deleteUserSecondGen', { userId }, { timeout: 540000 })")
        ).toBeLessThan(branch.indexOf('Backend.logout'))
    })

    it('awaits deletion and restores the popup after a visible failure', () => {
        const start = popupSource.indexOf('case CONFIRM_POPUP_TRIGGER_DELETE_USER:')
        const end = popupSource.indexOf('case CONFIRM_POPUP_TRIGGER_DELETE_TASK:', start)
        const branch = popupSource.slice(start, end)

        expect(branch).toContain('await deleteUser(user)')
        expect(branch).toContain("console.error('[Account deletion] Could not delete account', error)")
        expect(branch).toContain('setProcessing(false)')
        expect(branch).toContain('The account could not be deleted')
    })
})
