import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockUserId = 'u'
let mockArtifactWatchers = []
let mockUploadWatchers = []
jest.mock('react-redux', () => ({ useSelector: selector => selector({ loggedUser: { uid: mockUserId } }) }))
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    watchProjectArtifacts: (projectId, options, onChange, onError) => {
        const watcher = { projectId, options, onChange, onError, stop: jest.fn() }
        mockArtifactWatchers.push(watcher)
        return watcher.stop
    },
    watchProjectUploads: (projectId, onChange, onError) => {
        const watcher = { projectId, onChange, onError, stop: jest.fn() }
        mockUploadWatchers.push(watcher)
        return watcher.stop
    },
    watchArtifact: () => () => {},
    watchArtifactVersions: () => () => {},
}))

import { useProjectArtifacts } from './useArtifacts'
import { resetArtifactsLocalCacheForTests } from '../../utils/backends/Artifacts/artifactsLocalCache'

const artifact = (id, lastEditionDate = 1) => ({ id, title: id, lastEditionDate })
const upload = (id, lastEditionDate = 1) => ({ id: `upload:${id}`, title: id, linkedUpload: true, lastEditionDate })
const ids = result => result.artifacts.map(item => item.id)

let result
function Probe({ projectId = 'p', followedOnly = false }) {
    result = useProjectArtifacts(projectId, followedOnly)
    return null
}

let tree
const mount = props => {
    act(() => {
        tree = renderer.create(<Probe {...props} />)
    })
}
const unmount = () => act(() => tree.unmount())
const lastArtifacts = () => mockArtifactWatchers.at(-1)
const lastUploads = () => mockUploadWatchers.at(-1)

// A first visit: the live lists arrive and the uploads settle.
const visitOnce = () => {
    mount()
    act(() => lastArtifacts().onChange([artifact('dashboard', 5)]))
    act(() => lastUploads().onChange([upload('shot.png', 3)], { settled: true }))
    unmount()
}

beforeEach(() => {
    mockUserId = 'u'
    mockArtifactWatchers = []
    mockUploadWatchers = []
    resetArtifactsLocalCacheForTests()
})

it('waits for the first snapshot on a first visit, as before', () => {
    mount()
    expect(result.loaded).toBe(false)
    expect(result.artifacts).toEqual([])
    act(() => lastArtifacts().onChange([artifact('dashboard')]))
    expect(result.loaded).toBe(true)
    expect(ids(result)).toEqual(['dashboard'])
})

it('shows what the last visit showed at once, before any listener has answered', () => {
    visitOnce()
    mount()
    expect(result.loaded).toBe(true)
    expect(ids(result)).toEqual(['dashboard', 'upload:shot.png'])
})

it('replaces the remembered artifacts with the first live snapshot', () => {
    visitOnce()
    mount()
    act(() => lastArtifacts().onChange([artifact('report', 9)]))
    expect(ids(result)).toEqual(['report', 'upload:shot.png'])
})

it('keeps the remembered files while the uploads are still being gathered, adding new ones', () => {
    visitOnce()
    mount()
    act(() => lastUploads().onChange([], { settled: false }))
    expect(ids(result)).toEqual(['dashboard', 'upload:shot.png'])
    act(() => lastUploads().onChange([upload('new.pdf', 4)], { settled: false }))
    expect(ids(result)).toEqual(['dashboard', 'upload:new.pdf', 'upload:shot.png'])

    // Settled: the live list is the truth, and what is gone is gone.
    act(() => lastUploads().onChange([upload('new.pdf', 4)], { settled: true }))
    expect(ids(result)).toEqual(['dashboard', 'upload:new.pdf'])
    unmount()
    mount()
    expect(ids(result)).toEqual(['dashboard', 'upload:new.pdf'])
})

it('fills in uploads file by file when nothing is remembered', () => {
    mount()
    act(() => lastUploads().onChange([upload('a.pdf')], { settled: false }))
    expect(ids(result)).toEqual(['upload:a.pdf'])
})

it('does not remember an uploads list that a failing listener left incomplete', () => {
    visitOnce()
    mount()
    act(() => lastUploads().onError({ code: 'permission-denied' }))
    act(() => lastUploads().onChange([], { settled: true }))
    expect(result.uploadsError).toBe(true)
    expect(ids(result)).toEqual(['dashboard'])
    unmount()
    mount()
    expect(ids(result)).toEqual(['dashboard', 'upload:shot.png'])
})

it('drops a remembered list when its listener fails before confirming it', () => {
    visitOnce()
    mount()
    act(() => lastArtifacts().onError({ code: 'permission-denied' }))
    expect(result.loaded).toBe(true)
    expect(ids(result)).toEqual(['upload:shot.png'])
})

it('never shows one user what another user’s visit left behind', () => {
    visitOnce()
    mockUserId = 'someone-else'
    mount()
    expect(result.loaded).toBe(false)
    expect(result.artifacts).toEqual([])
})

it('remembers the followed tab separately and gathers no uploads there', () => {
    visitOnce()
    mount({ followedOnly: true })
    expect(result.loaded).toBe(false)
    expect(lastUploads().projectId).toBe('p')
    expect(mockUploadWatchers).toHaveLength(1)
    act(() => lastArtifacts().onChange([artifact('followed')]))
    expect(ids(result)).toEqual(['followed'])
})
