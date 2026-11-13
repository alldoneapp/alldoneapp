import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
    getAnnaProjectChoices,
    isAnnaProjectSelectable,
    readAnnaProjectSelection,
    resolveAnnaProjectAssistant,
    saveAnnaProjectSelection,
} from './annaProjectSelection'
import useAnnaProjectSelection from './useAnnaProjectSelection'

let mockVisible = null
jest.mock('../../utils/appResume', () => ({
    subscribePageVisible: callback => {
        mockVisible = callback
        return () => {}
    },
}))

const anna = { uid: 'anna', displayName: 'Anna' }
const cto = { uid: 'cto', displayName: 'Alldone CTO' }
const user = {
    uid: 'u1',
    defaultProjectId: 'home',
    projectIds: ['home', 'product', 'team', 'old', 'guide'],
    archivedProjectIds: ['old'],
    templateProjectIds: [],
    guideProjectIds: ['guide'],
    timezone: 'Europe/Berlin',
}
const projectsMap = {
    home: { id: 'home', name: 'Home', userIds: ['u1'], sortIndexByUser: { u1: 1 } },
    product: {
        id: 'product',
        name: 'Alldone Product',
        color: '#0c66ff',
        userIds: ['u1', 'karsten'],
        assistantId: 'cto',
        sortIndexByUser: { u1: 5 },
    },
    team: { id: 'team', name: 'Alldone Team', userIds: ['u1'], sortIndexByUser: { u1: 9 } },
    old: { id: 'old', name: 'Archived', userIds: ['u1'] },
    guide: { id: 'guide', name: 'Guide', userIds: ['u1'] },
}

describe('which projects and assistants the switcher offers', () => {
    it('lists active projects only, default first, then in sidebar order', () => {
        const choices = getAnnaProjectChoices({
            user,
            projectsMap,
            projectAssistants: { product: [cto] },
            defaultAssistant: anna,
        })
        expect(choices.map(choice => choice.id)).toEqual(['home', 'team', 'product'])
        expect(choices[0]).toMatchObject({ isDefault: true, assistant: anna, isShared: false })
        expect(choices.find(choice => choice.id === 'product')).toMatchObject({
            assistant: cto,
            isProjectAssistant: true,
            isShared: true,
            color: '#0c66ff',
        })
        // No assistant of its own: the default assistant answers there.
        expect(choices.find(choice => choice.id === 'team')).toMatchObject({
            assistant: anna,
            isProjectAssistant: false,
        })
    })

    it('prefers the flagged project default, accepts a global assistant and ignores a deleted one', () => {
        const designer = { uid: 'designer', isDefault: true }
        const resolve = (project, projectAssistants = {}, globalAssistants = []) =>
            resolveAnnaProjectAssistant({
                project,
                defaultProjectId: 'home',
                projectAssistants,
                globalAssistants,
                defaultAssistant: anna,
            }).assistant
        expect(resolve(projectsMap.product, { product: [cto, designer] })).toBe(designer)
        expect(resolve(projectsMap.product, {}, [cto])).toBe(cto)
        expect(resolve(projectsMap.product)).toBe(anna)
        // The default project always speaks as the default assistant.
        expect(resolve({ ...projectsMap.home, assistantId: 'cto' }, { home: [cto] })).toBe(anna)
    })

    it('never selects archived, template, guide or foreign projects', () => {
        expect(isAnnaProjectSelectable(user, 'product')).toBe(true)
        expect(isAnnaProjectSelectable(user, 'old')).toBe(false)
        expect(isAnnaProjectSelectable(user, 'guide')).toBe(false)
        expect(isAnnaProjectSelectable(user, 'someone-else')).toBe(false)
        expect(isAnnaProjectSelectable(user, '../home')).toBe(false)
    })
})

describe('remembering the choice until midnight', () => {
    beforeEach(() => localStorage.clear())

    it('keeps a selection for the day it was made on', () => {
        saveAnnaProjectSelection('u1', 'product', '20261029')
        expect(readAnnaProjectSelection('u1', '20261029')).toEqual({ projectId: 'product', dateKey: '20261029' })
        expect(readAnnaProjectSelection('u1', '20261030')).toBeNull()
        expect(readAnnaProjectSelection('u2', '20261029')).toBeNull()
        saveAnnaProjectSelection('u1', null, '20261029')
        expect(readAnnaProjectSelection('u1', '20261029')).toBeNull()
    })

    it('starts in the default project and returns to it after local midnight', async () => {
        jest.useFakeTimers()
        // 23:59 in Berlin.
        jest.setSystemTime(new Date('2026-10-29T22:59:00Z'))
        global.IS_REACT_ACT_ENVIRONMENT = true
        let selection
        const Harness = ({ account }) => {
            selection = useAnnaProjectSelection(account)
            return null
        }
        const root = createRoot(document.createElement('div'))
        try {
            await act(async () => root.render(<Harness account={user} />))
            expect(selection).toMatchObject({ projectId: 'home', isDefault: true })
            await act(async () => selection.select('product'))
            expect(selection).toMatchObject({ projectId: 'product', isDefault: false })
            // A reload on the same day restores it.
            await act(async () => root.render(<Harness account={{ ...user, uid: 'u1', other: 1 }} />))
            expect(selection.projectId).toBe('product')
            // The project is archived meanwhile: back to the default project.
            await act(async () => root.render(<Harness account={{ ...user, archivedProjectIds: ['product'] }} />))
            expect(selection.projectId).toBe('home')
            await act(async () => root.render(<Harness account={user} />))
            expect(selection.projectId).toBe('product')
            jest.setSystemTime(new Date('2026-10-29T23:00:30Z'))
            await act(async () => mockVisible())
            expect(selection).toMatchObject({ projectId: 'home', isDefault: true })
            expect(readAnnaProjectSelection('u1', '20261030')).toBeNull()
        } finally {
            act(() => root.unmount())
            jest.useRealTimers()
            delete global.IS_REACT_ACT_ENVIRONMENT
        }
    })
})
