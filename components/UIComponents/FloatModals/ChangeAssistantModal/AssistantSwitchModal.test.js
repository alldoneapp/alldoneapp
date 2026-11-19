import React from 'react'
import { Text, TextInput, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantSwitchModal, { ASSISTANT_SWITCH_SEARCH_TEST_ID } from './AssistantSwitchModal'
import AssistantItem from './AssistantItem'
import { resetEscapeStack } from '../../../../utils/escapeStack'
import { ModalShellContext } from '../../ModalShell/ModalShellContext'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../ModalHeader', () => 'ModalHeader')
jest.mock('../EmptyResults', () => 'EmptyResults')
jest.mock('../../../UIControls/CustomScrollView', () => 'CustomScrollView')
jest.mock('../../../AdminPanel/Assistants/AssistantAvatar', () => 'AssistantAvatar')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../utils/useWindowSize', () => () => [1024, 768])
jest.mock('../../../../utils/HelperFunctions', () => ({
    applyPopoverWidth: () => ({ width: 432 }),
    getPopoverWidth: () => 432,
}))
jest.mock('../../../../utils/modalSafeArea', () => ({ getSafeAreaModalMaxHeight: height => height - 32 }))
// Reached only by AssistantItem's own store-derived selection, which the switch popup overrides.
jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistantInProjectObject: jest.fn(() => ({ uid: 'never-used' })),
}))

const option = (projectId, assistantId, displayName) => ({
    key: `${projectId}:${assistantId}`,
    assistantId,
    projectId,
    projectName: projectId,
    isDefaultProjectAssistant: false,
    assistant: { uid: assistantId, displayName, description: '' },
})

const groups = [
    { projectId: 'p-personal', projectName: 'Personal', options: [option('p-personal', 'anna', 'Anna Alldone')] },
    {
        projectId: 'p-alldone',
        projectName: 'Alldone Product',
        options: [option('p-alldone', 'marty', 'Marty Marketing')],
    },
    { projectId: 'p-jtl', projectName: 'JTL', options: [option('p-jtl', 'jtl-marty', 'Marty Marketing')] },
]

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(<AssistantSwitchModal groups={groups} {...props} />)
    })
    return tree
}

beforeEach(() => {
    mockState = { smallScreen: false, smallScreenNavigation: false }
    // Trees are not unmounted between cases; start every case with an empty Escape stack.
    resetEscapeStack()
})

describe('AssistantSwitchModal (AT-2430)', () => {
    it('renders a header per project when grouped', () => {
        const tree = render({ grouped: true })
        const headers = tree.root
            .findAllByType(Text)
            .map(node => node.props.children)
            .filter(child => typeof child === 'string')

        expect(headers).toEqual(expect.arrayContaining(['Personal', 'Alldone Product', 'JTL']))
        expect(tree.root.findAllByType(AssistantItem)).toHaveLength(3)
    })

    it('renders no project headers for a single-project switch', () => {
        const tree = render({ grouped: false, groups: [groups[1]] })
        const texts = tree.root
            .findAllByType(Text)
            .map(node => node.props.children)
            .filter(child => typeof child === 'string')

        expect(texts).not.toContain('Alldone Product')
        expect(tree.root.findAllByType(AssistantItem)).toHaveLength(1)
    })

    it('marks only the row of the active assistant IN the active project', () => {
        // The account really does have two different assistants both called "Marty Marketing";
        // matching on the id alone would tick both.
        const tree = render({ grouped: true, activeProjectId: 'p-jtl', activeAssistantId: 'jtl-marty' })
        const selected = tree.root.findAllByType(AssistantItem).filter(item => item.props.selected)

        expect(selected).toHaveLength(1)
        expect(selected[0].props.projectId).toBe('p-jtl')
    })

    it('reports the chosen option and closes', () => {
        const onSelect = jest.fn()
        const closeModal = jest.fn()
        const tree = render({ grouped: true, onSelect, closeModal })

        const row = tree.root.findAllByType(AssistantItem)[2]
        act(() => row.findByType(TouchableOpacity).props.onPress())

        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect.mock.calls[0][0].assistantId).toBe('jtl-marty')
        expect(onSelect.mock.calls[0][0].projectId).toBe('p-jtl')
        expect(closeModal).toHaveBeenCalled()
    })

    it('reports a re-selection of the active row too, so the popup always closes', () => {
        const onSelect = jest.fn()
        const closeModal = jest.fn()
        const tree = render({
            grouped: true,
            activeProjectId: 'p-personal',
            activeAssistantId: 'anna',
            onSelect,
            closeModal,
        })

        act(() => tree.root.findAllByType(AssistantItem)[0].findByType(TouchableOpacity).props.onPress())

        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(closeModal).toHaveBeenCalled()
    })

    it('survives an empty list rather than crashing the line', () => {
        const tree = render({ grouped: true, groups: [] })
        expect(tree.root.findAllByType(AssistantItem)).toHaveLength(0)
    })

    describe('search (AT-3100)', () => {
        const search = (tree, text) => {
            const input = tree.root.findByProps({ testID: ASSISTANT_SWITCH_SEARCH_TEST_ID })
            act(() => input.props.onChangeText(text))
            return input
        }
        const headerTexts = tree =>
            tree.root
                .findAllByType(Text)
                .map(node => node.props.children)
                .filter(child => typeof child === 'string')
        const names = tree => tree.root.findAllByType(AssistantItem).map(item => item.props.assistant.displayName)

        it('shows a labelled search field', () => {
            const tree = render({ grouped: true })
            const input = tree.root.findByType(TextInput)

            expect(input.props.placeholder).toBe('Search assistants')
            expect(input.props.accessibilityLabel).toBe('Search assistants')
            // Focus is a deferred effect (AT-3113), never `autoFocus`, which would fire on phones too.
            expect(input.props.autoFocus).toBeFalsy()
        })

        it('filters case-insensitively by name and hides groups without a match', () => {
            const tree = render({ grouped: true })
            search(tree, '  mARTY ')

            expect(names(tree)).toEqual(['Marty Marketing', 'Marty Marketing'])
            const headers = headerTexts(tree)
            expect(headers).toEqual(expect.arrayContaining(['Alldone Product', 'JTL']))
            expect(headers).not.toContain('Personal')
        })

        it('does not match on the project name', () => {
            const tree = render({ grouped: true })
            search(tree, 'JTL')

            expect(tree.root.findAllByType(AssistantItem)).toHaveLength(0)
        })

        it('shows the empty state when nothing matches, and clearing restores the full list', () => {
            const tree = render({ grouped: true })
            search(tree, 'zzz')

            expect(tree.root.findAllByType(AssistantItem)).toHaveLength(0)
            const empty = tree.root.findByType('EmptyResults')
            expect(empty.props.text).toBe('No assistants found')

            const clear = tree.root.findByProps({ accessibilityLabel: 'Clear' })
            act(() => clear.props.onPress())

            expect(tree.root.findAllByType('EmptyResults')).toHaveLength(0)
            expect(tree.root.findAllByType(AssistantItem)).toHaveLength(3)
            expect(headerTexts(tree)).toEqual(expect.arrayContaining(['Personal', 'Alldone Product', 'JTL']))
        })

        it('keeps the selected row marked while filtering', () => {
            const tree = render({ grouped: true, activeProjectId: 'p-jtl', activeAssistantId: 'jtl-marty' })
            search(tree, 'marty')

            const selected = tree.root.findAllByType(AssistantItem).filter(item => item.props.selected)
            expect(selected).toHaveLength(1)
            expect(selected[0].props.projectId).toBe('p-jtl')
        })

        it('selects a filtered row exactly like an unfiltered one', () => {
            const onSelect = jest.fn()
            const closeModal = jest.fn()
            const tree = render({ grouped: true, onSelect, closeModal })
            search(tree, 'marty')

            act(() => tree.root.findAllByType(AssistantItem)[1].findByType(TouchableOpacity).props.onPress())

            expect(onSelect).toHaveBeenCalledTimes(1)
            expect(onSelect.mock.calls[0][0].projectId).toBe('p-jtl')
            expect(closeModal).toHaveBeenCalled()
        })

        it('Enter picks the first match; with no query or no match it does nothing', () => {
            const onSelect = jest.fn()
            const closeModal = jest.fn()
            const tree = render({ grouped: true, onSelect, closeModal })
            const input = tree.root.findByType(TextInput)

            act(() => input.props.onSubmitEditing())
            search(tree, 'nobody')
            act(() => tree.root.findByType(TextInput).props.onSubmitEditing())
            expect(onSelect).not.toHaveBeenCalled()

            search(tree, 'marty')
            act(() => tree.root.findByType(TextInput).props.onSubmitEditing())

            expect(onSelect).toHaveBeenCalledTimes(1)
            expect(onSelect.mock.calls[0][0].projectId).toBe('p-alldone')
            expect(closeModal).toHaveBeenCalled()
        })

        it('Escape clears a non-empty query', () => {
            const tree = render({ grouped: true })
            search(tree, 'marty')

            act(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            })

            expect(tree.root.findByType(TextInput).props.value).toBe('')
            expect(tree.root.findAllByType(AssistantItem)).toHaveLength(3)
        })
    })
})

describe('AssistantSwitchModal focus on open (AT-3113)', () => {
    let focus

    // A TextInput host node with a spy `focus`, so the test sees what the browser would get.
    const renderWithInputNode = ({ presentation = null, ...props } = {}) => {
        const element = <AssistantSwitchModal groups={groups} grouped={true} {...props} />
        let tree
        act(() => {
            tree = renderer.create(
                presentation ? (
                    <ModalShellContext.Provider value={{ presentation }}>{element}</ModalShellContext.Provider>
                ) : (
                    element
                ),
                { createNodeMock: () => ({ focus }) }
            )
        })
        return tree
    }

    beforeEach(() => {
        jest.useFakeTimers()
        focus = jest.fn()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('focuses the search on desktop as soon as the popup opens, like Templates', () => {
        renderWithInputNode()

        // Deferred one tick (same as AssistantTaskSearchModal), so the popover can place the card.
        expect(focus).not.toHaveBeenCalled()
        act(() => jest.runOnlyPendingTimers())
        expect(focus).toHaveBeenCalledTimes(1)
    })

    it('leaves the search unfocused on a phone, so no keyboard covers the list', () => {
        mockState = { ...mockState, smallScreenNavigation: true }
        renderWithInputNode()

        act(() => jest.runAllTimers())
        expect(focus).not.toHaveBeenCalled()
    })

    it('leaves the search unfocused in the bottom sheet even when the navigation is desktop', () => {
        renderWithInputNode({ presentation: 'sheet' })

        act(() => jest.runAllTimers())
        expect(focus).not.toHaveBeenCalled()
    })

    it('does not focus later when the viewport turns desktop while the popup is open', () => {
        mockState = { ...mockState, smallScreenNavigation: true }
        const tree = renderWithInputNode()
        act(() => jest.runAllTimers())

        mockState = { ...mockState, smallScreenNavigation: false }
        act(() => tree.update(<AssistantSwitchModal groups={groups} grouped={true} />))
        act(() => jest.runAllTimers())

        expect(focus).not.toHaveBeenCalled()
    })

    it('does not focus a popup closed before the deferred focus ran', () => {
        const tree = renderWithInputNode()
        act(() => tree.unmount())

        act(() => jest.runAllTimers())
        expect(focus).not.toHaveBeenCalled()
    })
})
