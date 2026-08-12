/**
 * @jest-environment jsdom
 *
 * The search popup's filter chips (successor of the stacked checkbox rows —
 * the CreatedByMeOption/SearchScopeOptions suites folded in here). Selection
 * is the chip background, toggling is a plain press, the archived chip only
 * exists for an all-projects scope, and "Include templates & guides" is gone
 * for good: templates/guides are searched only by picking one as the scope.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { ALL_PROJECTS_OPTION } from '../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

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
                includeArchived={false}
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
    it('renders scope, created-by-me and archived chips for an all-projects scope', () => {
        const component = render()

        expect(component.root.findAllByType(ScopeChip)).toHaveLength(1)
        expect(chipByTestID(component, 'search-filter-created-by-me')).toBeTruthy()
        expect(chipByTestID(component, 'search-filter-archived')).toBeTruthy()
        act(() => component.unmount())
    })

    it('hides the archived chip while a specific project is the scope', () => {
        const component = render({
            selectedProject: { id: 'project-1', name: 'My project', color: 'sky' },
            showArchivedChip: false,
        })

        expect(chipByTestID(component, 'search-filter-archived')).toBeUndefined()
        act(() => component.unmount())
    })

    it('never renders a templates & guides control', () => {
        const component = render()

        expect(JSON.stringify(component.toJSON())).not.toContain('templates')
        act(() => component.unmount())
    })

    it('reflects the filter state in the chip selection', () => {
        const off = render()
        expect(chipByTestID(off, 'search-filter-created-by-me').props.selected).toBe(false)

        const on = render({ createdByMeOnly: true, includeArchived: true })
        expect(chipByTestID(on, 'search-filter-created-by-me').props.selected).toBe(true)
        expect(chipByTestID(on, 'search-filter-archived').props.selected).toBe(true)

        act(() => off.unmount())
        act(() => on.unmount())
    })

    it('toggles on press and opens the scope picker from the scope chip', () => {
        const onToggleCreatedByMe = jest.fn()
        const onToggleArchived = jest.fn()
        const onOpenScope = jest.fn()
        const component = render({ onToggleCreatedByMe, onToggleArchived, onOpenScope })

        act(() => chipByTestID(component, 'search-filter-created-by-me').props.onPress())
        act(() => chipByTestID(component, 'search-filter-archived').props.onPress())
        act(() => component.root.findByType(ScopeChip).props.onPress())

        expect(onToggleCreatedByMe).toHaveBeenCalledTimes(1)
        expect(onToggleArchived).toHaveBeenCalledTimes(1)
        expect(onOpenScope).toHaveBeenCalledTimes(1)
        act(() => component.unmount())
    })

    it('shows the project name and circle when a project is the scope', () => {
        const component = render({
            selectedProject: { id: 'project-1', name: 'Alldone Product', color: 'sky' },
            showArchivedChip: false,
        })

        expect(JSON.stringify(component.toJSON())).toContain('Alldone Product')
        act(() => component.unmount())
    })
})
