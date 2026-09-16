/**
 * @jest-environment jsdom
 *
 * The search popup's filter chips (successor of the stacked checkbox rows —
 * the CreatedByMeOption/SearchScopeOptions suites folded in here). Selection
 * is the chip background and toggling is a plain press.
 *
 * One control is gone for good and is pinned as absent, because it was removed
 * on purpose and a regression would silently restore an overlapping way to say
 * the same thing: "Include templates & guides" (templates/guides are searched
 * only by picking one as the scope).
 *
 * The archived toggle is NOT in that category any more. AT-2390 removed it as
 * an overlapping second archived control; AT-2524 brought it back as "Include
 * archived" with a distinct meaning — the chip widens a group scope to active
 * AND archived, while the picker's "All archived" scope searches archived only.
 * What is pinned here now is that distinction: the chip renders for a group
 * scope, is ON by default, and stays hidden where it could not mean anything.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import {
    ALL_ARCHIVED_PROJECTS_OPTION,
    ALL_PROJECTS_OPTION,
} from '../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

const mockState = {
    loggedUser: { photoURL: 'https://example.com/me.png' },
    smallScreenNavigation: false,
}

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))

import SearchFilterChips, {
    ARCHIVED_CHIP_LABEL,
    CREATED_BY_ME_CHIP_LABEL,
    ScopeChip,
    ToggleChip,
} from './SearchFilterChips'
import { translate } from '../../../i18n/TranslationService'

// The defaults mirror what GlobalSearchModal passes on open: a group scope,
// "only created by me" off, "include archived" ON and shown.
const render = props => {
    let component
    act(() => {
        component = renderer.create(
            <SearchFilterChips
                selectedProject={{ id: ALL_PROJECTS_OPTION }}
                onOpenScope={jest.fn()}
                createdByMeOnly={false}
                onToggleCreatedByMe={jest.fn()}
                includeArchived={true}
                onToggleArchived={jest.fn()}
                showArchivedChip={true}
                {...props}
            />
        )
    })
    return component
}

const chipByTestID = (component, testID) =>
    component.root.findAllByType(ToggleChip).find(chip => chip.props.testID === testID)

describe('SearchFilterChips', () => {
    it('renders exactly the scope picker and the two toggles', () => {
        const component = render()

        expect(component.root.findAllByType(ScopeChip)).toHaveLength(1)
        expect(chipByTestID(component, 'search-filter-created-by-me')).toBeTruthy()
        expect(chipByTestID(component, 'search-filter-archived')).toBeTruthy()
        expect(component.root.findAllByType(ToggleChip)).toHaveLength(2)
        act(() => component.unmount())
    })

    it('renders the archived chip directly in the row, selected by default (AT-2524)', () => {
        // "Directly" is the requirement: reachable without opening the scope
        // picker, the same discoverability rule the created-by-me chip already
        // has. And it opens ON, so an all-projects search covers archived work
        // unless the user narrows it.
        const component = render()

        expect(chipByTestID(component, 'search-filter-archived').props.selected).toBe(true)
        expect(JSON.stringify(component.toJSON())).toContain(translate(ARCHIVED_CHIP_LABEL))
        act(() => component.unmount())
    })

    it('hides the archived chip when the modal says it cannot mean anything', () => {
        // The modal owns the decision (single-project scope, or a user with no
        // archived projects at all); the row just honours it. Hidden rather
        // than inert: a chip that is visibly ON and changes nothing is worse
        // than no chip.
        const hidden = render({ showArchivedChip: false })

        expect(chipByTestID(hidden, 'search-filter-archived')).toBeUndefined()
        // The other two controls are untouched by that.
        expect(hidden.root.findAllByType(ScopeChip)).toHaveLength(1)
        expect(chipByTestID(hidden, 'search-filter-created-by-me')).toBeTruthy()
        act(() => hidden.unmount())
    })

    it('reflects the archived state in the chip selection and toggles on press', () => {
        const onToggleArchived = jest.fn()
        const off = render({ includeArchived: false, onToggleArchived })

        expect(chipByTestID(off, 'search-filter-archived').props.selected).toBe(false)
        act(() => chipByTestID(off, 'search-filter-archived').props.onPress())
        expect(onToggleArchived).toHaveBeenCalledTimes(1)
        act(() => off.unmount())
    })

    it('labels the scope chip for each group scope', () => {
        const allProjects = render()
        expect(JSON.stringify(allProjects.toJSON())).toContain('All projects')

        const allArchived = render({ selectedProject: { id: ALL_ARCHIVED_PROJECTS_OPTION } })
        expect(JSON.stringify(allArchived.toJSON())).toContain('All archived')

        act(() => allProjects.unmount())
        act(() => allArchived.unmount())
    })

    it('never renders a templates & guides control', () => {
        const component = render()

        expect(JSON.stringify(component.toJSON())).not.toContain('templates')
        act(() => component.unmount())
    })

    it('labels the creator chip "Only created by me" (AT-2524)', () => {
        // The rename is the whole point: "Created by me" read as a description
        // of the results, not as a narrowing of them.
        const component = render()

        expect(CREATED_BY_ME_CHIP_LABEL).toBe('Only created by me')
        const rendered = JSON.stringify(component.toJSON())
        expect(rendered).toContain(translate(CREATED_BY_ME_CHIP_LABEL))
        expect(rendered).not.toContain('>Created by me<')
        act(() => component.unmount())
    })

    it('has a real translation for both chip labels in every locale', () => {
        // i18n-js answers a missing key with `[missing "de.…" translation]`,
        // which renders as that literal string in the chip. Locale files are
        // the one place this component's labels can silently break.
        const locales = ['en', 'de', 'es']
        const translations = {
            en: require('../../../i18n/translations/en.json'),
            de: require('../../../i18n/translations/de.json'),
            es: require('../../../i18n/translations/es.json'),
        }

        locales.forEach(locale => {
            ;[ARCHIVED_CHIP_LABEL, CREATED_BY_ME_CHIP_LABEL].forEach(label => {
                expect(typeof translations[locale][label]).toBe('string')
                expect(translations[locale][label].length).toBeGreaterThan(0)
            })
        })
    })

    it('reflects the filter state in the chip selection', () => {
        const off = render()
        expect(chipByTestID(off, 'search-filter-created-by-me').props.selected).toBe(false)

        const on = render({ createdByMeOnly: true })
        expect(chipByTestID(on, 'search-filter-created-by-me').props.selected).toBe(true)

        act(() => off.unmount())
        act(() => on.unmount())
    })

    it('toggles on press and opens the scope picker from the scope chip', () => {
        const onToggleCreatedByMe = jest.fn()
        const onOpenScope = jest.fn()
        const component = render({ onToggleCreatedByMe, onOpenScope })

        act(() => chipByTestID(component, 'search-filter-created-by-me').props.onPress())
        act(() => component.root.findByType(ScopeChip).props.onPress())

        expect(onToggleCreatedByMe).toHaveBeenCalledTimes(1)
        expect(onOpenScope).toHaveBeenCalledTimes(1)
        act(() => component.unmount())
    })

    it('shows the project name and circle when a project is the scope', () => {
        const component = render({
            selectedProject: { id: 'project-1', name: 'Alldone Product', color: 'sky' },
        })

        expect(JSON.stringify(component.toJSON())).toContain('Alldone Product')
        act(() => component.unmount())
    })
})
