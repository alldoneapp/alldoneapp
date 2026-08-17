import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import store from '../../redux/store'
import {
    getAllNotesAmount,
    getFollowedNotesAmount,
    watchAllNotesAmount,
    watchFollowedNotesAmount,
} from '../../utils/backends/Notes/noteNumbers'
import NotesHeader from './NotesHeader'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: index => index === -1,
}))
jest.mock('../../utils/backends/Notes/noteNumbers', () => ({
    getAllNotesAmount: jest.fn(),
    getFollowedNotesAmount: jest.fn(),
    unwatchNotesAmount: jest.fn(),
    watchAllNotesAmount: jest.fn(),
    watchFollowedNotesAmount: jest.fn(),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))

const PROJECTS = [{ id: 'project-1' }, { id: 'project-2' }]
const baseState = {
    loggedUserProjects: PROJECTS,
    notesActiveTab: 0,
    loggedUser: { archivedProjectIds: [], templateProjectIds: [] },
    selectedProjectIndex: -1,
}

const renderHeader = async state => {
    useSelector.mockImplementation(selector => selector(state))
    store.getState.mockReturnValue(state)
    let tree
    await act(async () => {
        tree = renderer.create(<NotesHeader />)
        await Promise.resolve()
        await Promise.resolve()
    })
    return tree
}

describe('NotesHeader count strategy', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
        getAllNotesAmount.mockResolvedValue(12)
        getFollowedNotesAmount.mockResolvedValue(10)
    })

    afterEach(() => jest.useRealTimers())

    it('uses lightweight aggregation for All Projects instead of document listeners', async () => {
        const tree = await renderHeader(baseState)

        expect(getFollowedNotesAmount).toHaveBeenCalledWith(['project-1', 'project-2'])
        expect(watchFollowedNotesAmount).not.toHaveBeenCalled()

        act(() => tree.unmount())
    })

    it('keeps the existing realtime listener for a single project', async () => {
        const state = { ...baseState, notesActiveTab: 1, selectedProjectIndex: 0 }
        const tree = await renderHeader(state)

        expect(watchAllNotesAmount).toHaveBeenCalledTimes(1)
        expect(getAllNotesAmount).not.toHaveBeenCalled()

        act(() => tree.unmount())
    })
})
