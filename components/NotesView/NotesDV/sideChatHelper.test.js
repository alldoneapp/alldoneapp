import { canOpenNoteSideChat, canShowNoteSideChat, getNoteSideChatWidth } from './sideChatHelper'

describe('note side chat helper', () => {
    it('uses 30 percent width with a 360px minimum', () => {
        expect(getNoteSideChatWidth(970)).toBe(360)
        expect(getNoteSideChatWidth(1600)).toBe(480)
    })

    it('allows side chat only on wide non-mobile layouts', () => {
        expect(canShowNoteSideChat({ mobile: false, contentWidth: 970 })).toBe(true)
        expect(canShowNoteSideChat({ mobile: false, contentWidth: 969 })).toBe(false)
        expect(canShowNoteSideChat({ mobile: true, contentWidth: 1600 })).toBe(false)
    })

    it('opens only for the current root note chat', () => {
        const base = {
            mobile: false,
            contentWidth: 1200,
            objectType: 'notes',
            objectId: 'note-1',
            noteId: 'note-1',
            toolbarProjectId: 'project-1',
            projectId: 'project-1',
        }

        expect(canOpenNoteSideChat(base)).toBe(true)
        expect(canOpenNoteSideChat({ ...base, objectType: 'tasks' })).toBe(false)
        expect(canOpenNoteSideChat({ ...base, objectId: 'note-2' })).toBe(false)
        expect(canOpenNoteSideChat({ ...base, toolbarProjectId: 'project-2' })).toBe(false)
    })
})
