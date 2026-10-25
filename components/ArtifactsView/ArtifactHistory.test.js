import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockOnHistory
const mockUnsubscribe = jest.fn()
const mockState = { projectUsers: { p1: [{ uid: 'owner', displayName: 'Karsten' }] } }
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    watchArtifactHistory: jest.fn((projectId, artifactId, onChange) => {
        mockOnHistory = onChange
        return mockUnsubscribe
    }),
}))
jest.mock('../Icon', () => () => null)
jest.mock('./artifactPresentation', () => ({ formatArtifactDate: date => `at ${date}` }))
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: id => (id === 'anna' ? { displayName: 'Anna' } : null),
}))

import ArtifactHistory, { describeArtifactHistoryEvent } from './ArtifactHistory'
import { watchArtifactHistory } from '../../utils/backends/Artifacts/artifactsFirestore'

const users = mockState.projectUsers.p1
const texts = tree =>
    tree.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children)

describe('ArtifactHistory', () => {
    beforeEach(() => jest.clearAllMocks())

    it('says who did what, naming the assistant that acted for someone', () => {
        expect(describeArtifactHistoryEvent({ type: 'created', actorId: 'owner', assistantId: 'anna' }, users)).toBe(
            'Anna for Karsten created the artifact'
        )
        expect(describeArtifactHistoryEvent({ type: 'version', actorId: 'owner', versionNumber: 3 }, users)).toBe(
            'Karsten saved version 3'
        )
        expect(describeArtifactHistoryEvent({ type: 'renamed', actorId: 'gone', from: 'Old', to: 'New' }, users)).toBe(
            'Someone renamed it from “Old” to “New”'
        )
        expect(describeArtifactHistoryEvent({ type: 'link_rotated', actorId: '' }, users)).toBe(
            'The link was renewed because someone lost access'
        )
        expect(describeArtifactHistoryEvent({ type: 'unknown' }, users)).toBe('')
    })

    it('says when the person acted through an MCP client', () => {
        expect(
            describeArtifactHistoryEvent(
                { type: 'version', actorId: 'owner', versionNumber: 2, via: 'mcp', viaClient: 'Claude' },
                users
            )
        ).toBe('Karsten (via Claude) saved version 2')
        expect(
            describeArtifactHistoryEvent({ type: 'renamed', actorId: 'owner', from: 'A', to: 'B', via: 'mcp' }, users)
        ).toBe('Karsten (via MCP) renamed it from “A” to “B”')
    })

    it('lists the history newest first as delivered, with an empty state', () => {
        let tree
        act(() => {
            tree = renderer.create(<ArtifactHistory projectId="p1" artifactId="a1" />)
        })
        expect(watchArtifactHistory).toHaveBeenCalledWith('p1', 'a1', expect.any(Function), expect.any(Function))

        act(() => mockOnHistory([]))
        expect(tree.root.findByProps({ testID: 'artifact-history-empty' })).toBeTruthy()

        act(() =>
            mockOnHistory([
                { id: 'h2', type: 'version', actorId: 'owner', versionNumber: 2, date: 2, changeSummary: 'Adds Q3' },
                { id: 'h1', type: 'created', actorId: 'owner', date: 1 },
            ])
        )
        const shown = texts(tree)
        expect(shown).toEqual(expect.arrayContaining(['Karsten saved version 2', 'Karsten created the artifact']))
        expect(shown.indexOf('Karsten saved version 2')).toBeLessThan(shown.indexOf('Karsten created the artifact'))

        act(() => tree.unmount())
        expect(mockUnsubscribe).toHaveBeenCalled()
    })
})
