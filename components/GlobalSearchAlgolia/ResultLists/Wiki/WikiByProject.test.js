import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../../searchFunctions', () => ({
    goToObjectDetailView: jest.fn(),
    getWikiPagePath: (projectId, slug) => `/projects/${projectId}/wiki/${slug}`,
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        checkIfProjectIdBelongsToInactiveProject: jest.fn(() => ({ inactive: false })),
        navigateToInactiveProject: jest.fn(),
    },
}))
jest.mock('../Common/ProjectHeader', () => () => null)
jest.mock('../../../Icon', () => () => null)

import WikiByProject from './WikiByProject'
import { goToObjectDetailView } from '../../searchFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

const PROJECT = { id: 'p1', name: 'Product' }
// Hits in the shape the Typesense adapter produces: `id` is the page slug.
const PAGES = [
    { id: 'preise', objectID: 'preisep1', projectId: 'p1', title: 'Preise und Credits', summary: 'Wie wir abrechnen.' },
    { id: 'team', objectID: 'teamp1', projectId: 'p1', title: 'Team', summary: '' },
]

describe('WikiByProject', () => {
    beforeEach(() => jest.clearAllMocks())

    it('shows title and summary and opens the page in its project wiki', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <WikiByProject project={PROJECT} pages={PAGES} activeItemIndex={1} activeItemRef={{}} />
            )
        })
        expect(JSON.stringify(tree.toJSON())).toContain('Preise und Credits')
        expect(JSON.stringify(tree.toJSON())).toContain('Wie wir abrechnen.')

        act(() => tree.root.findByProps({ testID: 'search-wiki-preise' }).props.onPress())
        expect(goToObjectDetailView).toHaveBeenCalledWith('p1', 'preise', 'wiki', 'wiki')

        ProjectHelper.checkIfProjectIdBelongsToInactiveProject.mockReturnValueOnce({
            inactive: true,
            projectType: 'archived',
        })
        act(() => tree.root.findByProps({ testID: 'search-wiki-team' }).props.onPress())
        expect(ProjectHelper.navigateToInactiveProject).toHaveBeenCalledWith('archived', '/projects/p1/wiki/team')
        act(() => tree.unmount())
    })

    it('renders nothing for a project without matches', () => {
        let tree
        act(() => {
            tree = renderer.create(<WikiByProject project={PROJECT} pages={[]} activeItemIndex={-1} />)
        })
        expect(tree.toJSON()).toBeNull()
        act(() => tree.unmount())
    })
})
