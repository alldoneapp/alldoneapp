import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockOnChange
const mockUnsubscribe = jest.fn()
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    watchObjectArtifacts: jest.fn((projectId, objectType, objectId, onChange) => {
        mockOnChange = onChange
        return mockUnsubscribe
    }),
}))
jest.mock('./artifactLinks', () => ({ openProjectArtifacts: jest.fn() }))
jest.mock('./ArtifactRow', () => {
    const { Text: MockText } = require('react-native')
    return {
        __esModule: true,
        default: ({ artifact, onPress }) => <MockText onPress={onPress}>{artifact.title}</MockText>,
    }
})

import ObjectArtifacts from './ObjectArtifacts'
import { watchObjectArtifacts } from '../../utils/backends/Artifacts/artifactsFirestore'
import { openProjectArtifacts } from './artifactLinks'

describe('ObjectArtifacts', () => {
    beforeEach(() => jest.clearAllMocks())

    it("lists what the object's thread produced and opens it", () => {
        let tree
        act(() => {
            tree = renderer.create(<ObjectArtifacts projectId="p1" objectType="tasks" objectId="t1" />)
        })
        expect(watchObjectArtifacts).toHaveBeenCalledWith(
            'p1',
            'tasks',
            't1',
            expect.any(Function),
            expect.any(Function)
        )
        expect(tree.toJSON()).toBeNull()

        act(() => mockOnChange([{ id: 'a1', title: 'Sales dashboard' }]))
        const row = tree.root.findAll(node => node.props.children === 'Sales dashboard' && node.props.onPress)[0]
        act(() => row.props.onPress())
        expect(openProjectArtifacts).toHaveBeenCalledWith('p1', 'a1')

        act(() => tree.unmount())
        expect(mockUnsubscribe).toHaveBeenCalled()
    })
})
