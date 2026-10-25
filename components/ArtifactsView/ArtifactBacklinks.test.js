import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockOnChange
const mockUnsubscribe = jest.fn()
const mockProcessUrl = jest.fn()
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    watchArtifactBacklinks: jest.fn((projectId, artifactId, onChange) => {
        mockOnChange = onChange
        return mockUnsubscribe
    }),
}))
jest.mock('../Icon', () => () => null)
jest.mock('../../URLSystem/URLTrigger', () => ({ __esModule: true, default: { processUrl: mockProcessUrl } }))
jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: {} }))

import ArtifactBacklinks, { getBacklinkPath } from './ArtifactBacklinks'
import { watchArtifactBacklinks } from '../../utils/backends/Artifacts/artifactsFirestore'

describe('ArtifactBacklinks', () => {
    beforeEach(() => jest.clearAllMocks())

    it('renders nothing until something links to the artifact', () => {
        let tree
        act(() => {
            tree = renderer.create(<ArtifactBacklinks projectId="p1" artifactId="a1" />)
        })
        expect(watchArtifactBacklinks).toHaveBeenCalledWith('p1', 'a1', expect.any(Function), expect.any(Function))
        expect(tree.toJSON()).toBeNull()
        act(() => tree.unmount())
        expect(mockUnsubscribe).toHaveBeenCalled()
    })

    it('lists the linking tasks and notes and opens them in their own view', () => {
        let tree
        act(() => {
            tree = renderer.create(<ArtifactBacklinks projectId="p1" artifactId="a1" />)
        })
        act(() =>
            mockOnChange([
                { type: 'note', id: 'n1', title: 'Weekly review', lastEditionDate: 2 },
                { type: 'task', id: 't1', title: 'Check the numbers', done: true, lastEditionDate: 1 },
            ])
        )
        expect(tree.root.findByProps({ testID: 'artifact-backlinks' })).toBeTruthy()

        act(() => tree.root.findByProps({ testID: 'artifact-backlink-task-t1' }).props.onPress())
        expect(mockProcessUrl).toHaveBeenCalledWith({}, '/projects/p1/tasks/t1/properties')

        act(() => tree.root.findByProps({ testID: 'artifact-backlink-note-n1' }).props.onPress())
        expect(mockProcessUrl).toHaveBeenCalledWith({}, '/projects/p1/notes/n1/editor')
    })

    it('builds the detail path of each linking object', () => {
        expect(getBacklinkPath('p1', { type: 'task', id: 't1' })).toBe('/projects/p1/tasks/t1/properties')
        expect(getBacklinkPath('p1', { type: 'note', id: 'n1' })).toBe('/projects/p1/notes/n1/editor')
    })
})
