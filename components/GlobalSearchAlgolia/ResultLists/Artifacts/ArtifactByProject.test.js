import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../../searchFunctions', () => ({ goToObjectDetailView: jest.fn() }))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        checkIfProjectIdBelongsToInactiveProject: jest.fn(() => ({ inactive: false })),
        navigateToInactiveProject: jest.fn(),
    },
}))
jest.mock('../Common/ProjectHeader', () => () => null)
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../ArtifactsView/artifactPresentation', () => ({ getArtifactKindIcon: () => 'globe' }))

import ArtifactByProject from './ArtifactByProject'
import { goToObjectDetailView } from '../../searchFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

const PROJECT = { id: 'p1', name: 'Product' }
const ARTIFACTS = [
    { id: 'a1', title: 'Churn dashboard', description: 'Monthly', isPublicFor: [0, 'u1'] },
    { id: 'a2', title: 'Private notes', isPublicFor: ['u1'] },
]

describe('ArtifactByProject', () => {
    beforeEach(() => jest.clearAllMocks())

    it('opens the artifact in its project, or through the inactive-project flow', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <ArtifactByProject project={PROJECT} artifacts={ARTIFACTS} activeItemIndex={1} activeItemRef={{}} />
            )
        })
        act(() => tree.root.findByProps({ testID: 'search-artifact-a1' }).props.onPress())
        expect(goToObjectDetailView).toHaveBeenCalledWith('p1', 'a1', 'artifacts', 'artifact')

        ProjectHelper.checkIfProjectIdBelongsToInactiveProject.mockReturnValueOnce({
            inactive: true,
            projectType: 'archived',
        })
        act(() => tree.root.findByProps({ testID: 'search-artifact-a2' }).props.onPress())
        expect(ProjectHelper.navigateToInactiveProject).toHaveBeenCalledWith('archived', '/projects/p1/artifacts/a2')
        act(() => tree.unmount())
    })

    it('renders nothing for a project without matches', () => {
        let tree
        act(() => {
            tree = renderer.create(<ArtifactByProject project={PROJECT} artifacts={[]} activeItemIndex={-1} />)
        })
        expect(tree.toJSON()).toBeNull()
        act(() => tree.unmount())
    })
})
