import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { useProjectsData } from './useProjectData'
import { ensureProjectsDataLoaded } from '../utils/InitialLoad/projectDataLoader'

jest.mock('../utils/InitialLoad/projectDataLoader', () => ({
    ensureProjectDataLoaded: jest.fn(),
    ensureProjectsDataLoaded: jest.fn(),
}))

const Probe = ({ enabled }) => {
    useProjectsData(['p1', 'p2'], 'assistants', { enabled })
    return null
}

describe('useProjectsData startup gating', () => {
    beforeEach(() => jest.clearAllMocks())

    it('does not arm project collection watchers before startup work is released', () => {
        act(() => {
            renderer.create(<Probe enabled={false} />)
        })

        expect(ensureProjectsDataLoaded).not.toHaveBeenCalled()
    })

    it('arms the same watchers once startup work is released', () => {
        act(() => {
            renderer.create(<Probe enabled />)
        })

        expect(ensureProjectsDataLoaded).toHaveBeenCalledWith(['p1', 'p2'], 'assistants')
    })
})
