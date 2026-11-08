import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../utils/backends/firestore', () => ({ rebuildProjectVmGolden: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../i18n/localizedMoment', () => ({ localizedMoment: () => ({ fromNow: () => 'just now' }) }))

import VmGoldenProperty from './VmGoldenProperty'

function statusText(project) {
    const tree = renderer.create(<VmGoldenProperty project={project} />)
    const texts = tree.root.findAll(node => node.type === 'Text' || node.type?.displayName === 'Text')
    return texts.map(node => node.props.children).flat()
}

// security audit 2026-11: the snapshot pointer moved to the server-only vmGoldens/{projectId}; the
// project doc only carries a display mirror with `hasSnapshot`, and the snapshot id is cleared.
describe('VmGoldenProperty', () => {
    const repo = { id: 'p1', githubRepoUrl: 'https://github.com/acme/app' }

    test('shows a ready golden from the display mirror without a snapshot id', () => {
        const text = statusText({
            ...repo,
            vmGolden: { status: 'ready', hasSnapshot: true, snapshotId: null, builtAt: 1 },
        })
        expect(text).toContain('VM environment ready built')
    })

    test('does not call a golden without a snapshot ready', () => {
        const text = statusText({ ...repo, vmGolden: { status: 'ready', hasSnapshot: false, snapshotId: null } })
        expect(text).toContain('VM environment not built')
    })
})
