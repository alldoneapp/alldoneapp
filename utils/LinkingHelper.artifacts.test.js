jest.mock('./backends/firestore', () => ({ getAppUrlHost: () => 'my.alldone.app' }))
jest.mock('../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({ __esModule: true, default: {} }))

import { getUrlObject, isValidArtifactLink, isValidNoteLink, LINKED_OBJECT_TYPE_ARTIFACT } from './LinkingHelper'

describe('links to artifacts', () => {
    const url = 'https://my.alldone.app/projects/p1/artifacts/a1'

    it('recognises an artifact of the project, including its chat', () => {
        expect(isValidArtifactLink(url, 'p1')).toBeTruthy()
        expect(isValidArtifactLink(`${url}/chat`, 'p1')).toBeTruthy()
        expect(isValidArtifactLink(url, 'other-project')).toBeFalsy()
        expect(isValidArtifactLink('https://example.com/projects/p1/artifacts/a1', 'p1')).toBeFalsy()
        expect(isValidNoteLink(url, 'p1')).toBeFalsy()
    })

    it('types an artifact link as an artifact', () => {
        expect(LINKED_OBJECT_TYPE_ARTIFACT).toBe('artifact')
        expect(getUrlObject(url, 'https://my.alldone.app', 'p1', 'editor-1').type).toBe('artifact')
    })
})
