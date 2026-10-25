import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockTitles
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    getArtifactContextTitle: jest.fn(async (projectId, source) => mockTitles[`${projectId}/${source.id}`]),
}))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key}(${params.title})` : key),
}))

import { getArtifactContextSources, resetArtifactContextTitlesForTests, useArtifactContext } from './artifactContext'
import { getArtifactContextTitle } from '../../utils/backends/Artifacts/artifactsFirestore'

let context
function Probe({ artifact, projectId = 'p' }) {
    context = useArtifactContext(projectId, artifact)
    return null
}
const render = async artifact => {
    let tree
    await act(async () => {
        tree = renderer.create(<Probe artifact={artifact} />)
    })
    return tree
}

beforeEach(() => {
    mockTitles = {}
    getArtifactContextTitle.mockClear()
    resetArtifactContextTitlesForTests()
})

it('names a linked upload’s sources and the thread an artifact was made in', () => {
    const sources = [{ type: 'notes', id: 'n', title: 'Notes' }]
    expect(getArtifactContextSources({ linkedUpload: true, linkedSources: sources })).toBe(sources)
    expect(getArtifactContextSources({ parentObject: { type: 'tasks', id: 't', projectId: 'other' } })).toEqual([
        { type: 'tasks', id: 't', projectId: 'other', inThread: true },
    ])
    expect(getArtifactContextSources({ parentObject: null })).toEqual([])
    expect(getArtifactContextSources(null)).toEqual([])
})

it('takes a linked upload’s source title as it is, with no read', async () => {
    await render({ linkedUpload: true, linkedSources: [{ type: 'notes', id: 'n', title: 'Meeting notes' }] })
    expect(context).toEqual({
        source: { type: 'notes', id: 'n', title: 'Meeting notes', projectId: 'p' },
        label: 'Artifact upload in(Meeting notes)',
    })
    expect(getArtifactContextTitle).not.toHaveBeenCalled()
})

it('reads the parent’s title once, in the parent’s own project', async () => {
    mockTitles['other/t'] = 'Prepare the offsite'
    const artifact = { parentObject: { type: 'tasks', id: 't', projectId: 'other' } }
    await render(artifact)
    expect(context.label).toBe('Artifact created in(Prepare the offsite)')
    expect(context.source.projectId).toBe('other')
    await render(artifact)
    expect(getArtifactContextTitle).toHaveBeenCalledTimes(1)
})

it('leaves an artifact unlinked when the viewer cannot see where it was made', async () => {
    mockTitles['p/private'] = null
    await render({ parentObject: { type: 'tasks', id: 'private' } })
    expect(context).toBeNull()
})

it('falls back to the kind of object while its title is unknown', async () => {
    mockTitles['p/t'] = ''
    await render({ parentObject: { type: 'goals', id: 't' } })
    expect(context.label).toBe('Artifact created in(Goal)')
})
