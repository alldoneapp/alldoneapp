const fs = require('fs')
const path = require('path')

describe('note secondary listeners', () => {
    it('does not register mutable collaboration presence for a read-only note', () => {
        const source = fs.readFileSync(path.resolve(__dirname, 'NotesEditorView.js'), 'utf8')

        expect(source).toMatch(/if \(!readOnlyRef\.current\) \{[^]*Backend\.addNoteEditor/)
        expect(source).toMatch(/noteCollabUnsubRef\.current = Backend\.watchNotesCollab/)
        expect(source).toMatch(/noteCollabUnsubRef\.current\?\.\(\)/)
        expect(source).toMatch(/if \(noteEditorPresenceRegisteredRef\.current\) \{[^]*Backend\.removeNoteEditor/)
    })

    it('does not start the member-only follower listener for a shared non-member', () => {
        const hookPath = path.resolve(
            __dirname,
            '../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/useFollowingDataListener.js'
        )
        const source = fs.readFileSync(hookPath, 'utf8')

        expect(source).toMatch(/const canWatchFollowers = !!project && SharedHelper\.accessGranted/)
        expect(source).toMatch(/if \(!canWatchFollowers \|\| !followObjectId\)/)
    })
})
