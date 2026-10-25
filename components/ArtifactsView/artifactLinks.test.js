import { openProjectUploads } from './artifactLinks'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import {
    getArtifactsActiveTab,
    getSelectedArtifactId,
    setArtifactsActiveTab,
    setSelectedArtifactId,
} from './artifactsNavigationState'

const mockNavigate = jest.fn()
jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../URLSystem/URLTrigger', () => ({
    __esModule: true,
    default: { processUrl: (...args) => mockNavigate(...args) },
}))

it('shows All uploads even when a full artifact or the Followed list was open', () => {
    setArtifactsActiveTab(FOLLOWED_TAB)
    setSelectedArtifactId('p', 'artifact-1')
    openProjectUploads('p')
    expect(getArtifactsActiveTab()).toBe(ALL_TAB)
    expect(getSelectedArtifactId('p')).toBeNull()
    expect(mockNavigate).toHaveBeenCalledWith({}, '/projects/p/artifacts')
})
