/**
 * @jest-environment jsdom
 *
 * The search popup's filter chips (successor of the stacked checkbox rows —
 * the CreatedByMeOption/SearchScopeOptions suites folded in here). Selection
 * is the chip background and toggling is a plain press.
 *
 * Two controls are gone for good and are pinned as absent, because both were
 * removed on purpose and a regression would silently restore an overlapping
 * way to say the same thing: "Include templates & guides" (templates/guides are
 * searched only by picking one as the scope) and, since AT-2390, the archived
 * toggle — archived is now a SCOPE, chosen in the picker.
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

import SearchFilterChips, { ScopeChip, ToggleChip } from './SearchFilterChips'

const render = props => {
    let component
    act(() => {
        component = renderer.create(
            <SearchFilterChips
                selectedProject={{ id: ALL_PROJECTS_OPTION }}
                onOpenScope={jest.fn()}
                createdByMeOnly={false}
                onToggleCreatedByMe={jest.fn()}
                {...props}
            />
        )
    })
    return component
}

const chipByTestID = (component, testID) =>
    component.root.findAllByType(ToggleChip).find(chip => chip.props.testID === testID)

describe('SearchFilterChips', () => {
    it('renders exactly the scope picker and the created-by-me toggle', () => {
        const component = render()

        expect(component.root.findAllByType(ScopeChip)).toHaveLength(1)
        expect(chipByTestID(component, 'search-filter-created-by-me')).toBeTruthy()
        expect(component.root.findAllByType(ToggleChip)).toHaveLength(1)
        act(() => component.unmount())
    })

    it('never renders an archived toggle, for any scope (AT-2390)', () => {
        // Archived is a scope now, not a filter. Two controls for one idea is
        // what this replaced.
        const allProjects = render()
        const allArchived = render({ selectedProject: { id: ALL_ARCHIVED_PROJECTS_OPTION } })
        const oneProject = render({ selectedProject: { id: 'project-1', name: 'My project', color: 'sky' } })

        ;[allProjects, allArchived, oneProject].forEach(component => {
            expect(chipByTestID(component, 'search-filter-archived')).toBeUndefined()
            act(() => component.unmount())
        })
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
