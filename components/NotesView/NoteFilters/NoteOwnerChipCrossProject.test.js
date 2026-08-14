/**
 * @jest-environment jsdom
 */

/**
 * AT-2194 — end-to-end RENDER regression for the "Unknown" owner chip.
 *
 * `noteOwnerFilterHelper.test.js` covers the resolver in isolation, and
 * `NoteOwnerFiltersLine.test.js` covers the chip row — but the latter MOCKS
 * `resolveNoteOwner`, so between them nothing ever asserted that a real note, resolved by the
 * real helper, actually RENDERS as the assistant. That is precisely the layer the production
 * bug lived in: the backend had always written the correct owner id, and only the rendered
 * chip said "Unknown".
 *
 * This suite therefore wires the REAL helper to the REAL component and reproduces the exact
 * production case, using the real ids from note `dsSHRqBYKPJsw4S3hpAa`:
 *
 *   note.projectId = -Ona1ph4uu0mdSl9zizI  (JTL Software – Project Juno)
 *   note.userId    = -OkEJjitS1l877eST9X8  ("Anna Alldone", lives ONLY in the user's
 *                                           DEFAULT project -MChwoc_417bzbCi0yuw)
 *
 * The trap the original bug fell into: a DIFFERENT "Anna Alldone" exists in the global pool
 * under id -Ns4cpvpLDeygvV2cjcJ. It matches by name but not by id, so a global-pool fallback
 * looks like it should resolve and silently does not. The fixture keeps that decoy in place.
 */

jest.mock('../../../redux/store', () => ({ getState: jest.fn() }))
jest.mock('../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'ws@' }))
jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    useDispatch: jest.fn(),
    shallowEqual: (a, b) => a === b,
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../Avatar', () => {
    const React = require('react')
    return props => React.createElement('Avatar', props)
})
jest.mock('../../Icon', () => {
    const React = require('react')
    return props => React.createElement('Icon', props)
})
jest.mock('../../../redux/actions', () => ({
    setNoteOwnerFilters: ownerIds => ({ type: 'Set note owner filters', ownerIds }),
    clearNoteOwnerFilters: () => ({ type: 'Clear note owner filters' }),
}))

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import NoteOwnerFiltersLine from './NoteOwnerFiltersLine'
import store from '../../../redux/store'

// Real production ids from the reported note.
const JUNO_PROJECT_ID = '-Ona1ph4uu0mdSl9zizI'
const DEFAULT_PROJECT_ID = '-MChwoc_417bzbCi0yuw'
const ANNA_ID = '-OkEJjitS1l877eST9X8'
const GLOBAL_ANNA_ID = '-Ns4cpvpLDeygvV2cjcJ' // same NAME, different id — the decoy
const KARSTEN_ID = 'lejVqrT6FBcMRRCxnBbBhQwPgSg1'

const notesByDate = {
    20260807: [
        { id: 'dsSHRqBYKPJsw4S3hpAa', userId: ANNA_ID, title: 'Transcription Test' },
        { id: 'note-human', userId: KARSTEN_ID, title: 'A note of mine' },
    ],
}

/** Mirrors the real client state: assistants are loaded for ALL of the user's projects. */
const setStoreState = () => {
    store.getState.mockReturnValue({
        projectUsers: {
            [JUNO_PROJECT_ID]: [{ uid: KARSTEN_ID, displayName: 'Karsten Wysk', photoURL: 'k.png' }],
        },
        projectAssistants: {
            // Juno's own assistants — Anna is deliberately NOT among them.
            [JUNO_PROJECT_ID]: [
                { uid: '-Opl-0IPPlv26577k_M2', displayName: 'JTL Assistant', photoURL: 'jtl.png' },
                { uid: '-Oq7EO-vvIZsv8RHM2fJ', displayName: 'Paul Product Manager', photoURL: 'paul.png' },
                { uid: '-OqGGRunN3bH2r39FveM', displayName: 'Clara Customer Success', photoURL: 'clara.png' },
            ],
            // The note's owner lives here, in a DIFFERENT project.
            [DEFAULT_PROJECT_ID]: [{ uid: ANNA_ID, displayName: 'Anna Alldone', photoURL: 'anna.png' }],
        },
        globalAssistants: [{ uid: GLOBAL_ANNA_ID, displayName: 'Anna Alldone', photoURL: 'global-anna.png' }],
        projectContacts: {},
        projectWorkstreams: {},
    })
}

const render = () => {
    let component
    act(() => {
        component = renderer.create(
            <NoteOwnerFiltersLine projectId={JUNO_PROJECT_ID} notes={notesByDate} stickyNotes={[]} />
        )
    })
    return component
}

/** The chip the component renders for a given owner id. */
const chipFor = (component, ownerId) =>
    component.root.findAll(node => node.props.testID === `note-owner-filter-${ownerId}`)[0]

describe('AT-2194: notes owner chip for an assistant outside the note project', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(jest.fn())
        useSelector.mockImplementation(selector => selector({ noteOwnerFilters: [], selectedProjectIndex: 0 }))
        setStoreState()
    })

    it('renders the assistant name, NOT the literal "Unknown" chip', () => {
        const chip = chipFor(render(), ANNA_ID)

        expect(chip).toBeDefined()
        expect(chip.props.label).toBe('Anna Alldone')
        expect(chip.props.label).not.toBe('Unknown')
    })

    it('renders the assistant flagged as an assistant, with its own avatar', () => {
        const chip = chipFor(render(), ANNA_ID)

        expect(chip.props.isAssistant).toBe(true)
        // The project-scoped Anna, not the same-named global decoy.
        expect(chip.props.photoURL).toBe('anna.png')
        expect(chip.props.photoURL).not.toBe('global-anna.png')
    })

    it('groups the note under the assistant with the right count, alongside the human owner', () => {
        const component = render()

        expect(chipFor(component, ANNA_ID).props.count).toBe(1)
        expect(chipFor(component, KARSTEN_ID).props.label).toBe('Karsten Wysk')
    })

    it('renders no chip labelled "Unknown" anywhere in the row', () => {
        const labels = render()
            .root.findAll(node => typeof node.props.label === 'string')
            .map(node => node.props.label)

        expect(labels).toContain('Anna Alldone')
        expect(labels).not.toContain('Unknown')
    })

    it('still falls back to "Unknown" for an id that resolves nowhere (guards over-reach)', () => {
        // A human from another project must NOT be resolved by the assistant-only fallback,
        // so the safety net is still reachable and this suite cannot pass vacuously.
        const component = (() => {
            useSelector.mockImplementation(selector => selector({ noteOwnerFilters: [], selectedProjectIndex: 0 }))
            let c
            act(() => {
                c = renderer.create(
                    <NoteOwnerFiltersLine
                        projectId={JUNO_PROJECT_ID}
                        notes={{
                            20260807: [
                                { id: 'n1', userId: 'someone-who-left', title: 'orphan' },
                                { id: 'n2', userId: KARSTEN_ID, title: 'mine' },
                            ],
                        }}
                        stickyNotes={[]}
                    />
                )
            })
            return c
        })()

        expect(chipFor(component, 'someone-who-left').props.label).toBe('Unknown')
    })
})
