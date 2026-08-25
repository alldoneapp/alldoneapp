import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantSwitchModal from './AssistantSwitchModal'
import AssistantItem from './AssistantItem'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../ModalHeader', () => 'ModalHeader')
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
})
