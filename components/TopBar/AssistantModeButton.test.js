import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'
import AssistantModeButton from './AssistantModeButton'
import AnnaChatNavigationContext from '../Anna/AnnaChatNavigationContext'
import { resolveAnnaLayout, setAnnaMode } from '../../utils/annaMode'

let mockState
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../AdminPanel/Assistants/AssistantAvatar', () => 'AssistantAvatar')
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

beforeEach(() => {
    mockState = {
        loggedUser: { isAnonymous: false },
        defaultAssistant: { uid: 'anna', displayName: 'Anna Alldone', photoURL50: 'anna.png' },
    }
    window.history.replaceState({}, '', '/projects/p1/notes/n1?filter=open#draft')
    setAnnaMode(false)
})

it('uses the configured assistant avatar and opens the chat through its shell context', () => {
    const showChat = jest.fn()
    const onOpen = jest.fn()
    const component = renderer.create(
        <AnnaChatNavigationContext.Provider value={showChat}>
            <AssistantModeButton onOpen={onOpen} />
        </AnnaChatNavigationContext.Provider>
    )
    expect(component.root.findByType('AssistantAvatar').props).toEqual(
        expect.objectContaining({ photoURL: 'anna.png', size: 28, assistantId: 'anna' })
    )
    const button = component.root.findByType(TouchableOpacity)
    expect(button.props.accessibilityLabel).toBe('Anna Alldone: Open assistant chat')
    act(() => button.props.onPress())
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(showChat).toHaveBeenCalledTimes(1)
})

it('enables assistant mode without changing the current page through the default context', () => {
    const component = renderer.create(<AssistantModeButton />)
    act(() => component.root.findByType(TouchableOpacity).props.onPress())
    expect(resolveAnnaLayout(window.location)).toBe('split')
    expect(window.location.pathname).toBe('/projects/p1/notes/n1')
    expect(window.location.search).toBe('?filter=open&assistant=1')
    expect(window.location.hash).toBe('#draft')
})

it('updates its avatar and label when the default project selects another assistant or that assistant is renamed', () => {
    const component = renderer.create(<AssistantModeButton />)
    mockState.defaultAssistant = { uid: 'mira', displayName: 'Mira', photoURL50: 'mira.png' }
    act(() => component.update(<AssistantModeButton />))
    expect(component.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe('Mira: Open assistant chat')
    expect(component.root.findByType('AssistantAvatar').props).toEqual(
        expect.objectContaining({ photoURL: 'mira.png', assistantId: 'mira' })
    )
    mockState.defaultAssistant = {
        ...mockState.defaultAssistant,
        displayName: 'Mira Coach',
        photoURL50: 'mira-new.png',
    }
    act(() => component.update(<AssistantModeButton />))
    expect(component.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe('Mira Coach: Open assistant chat')
    expect(component.root.findByType('AssistantAvatar').props.photoURL).toBe('mira-new.png')
})

it.each(['anonymous', 'missing assistant'])('hides the entry point for %s', state => {
    if (state === 'anonymous') mockState.loggedUser.isAnonymous = true
    else mockState.defaultAssistant = null
    expect(renderer.create(<AssistantModeButton />).toJSON()).toBeNull()
})
