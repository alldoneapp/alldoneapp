import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'
import AssistantModeButton from './AssistantModeButton'
import AnnaChatNavigationContext, { AnnaSidebarCloseContext } from '../Anna/AnnaChatNavigationContext'
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

it('opens the chat through its shell context using the panel icon without an avatar', () => {
    const showChat = jest.fn()
    const onOpen = jest.fn()
    const component = renderer.create(
        <AnnaChatNavigationContext.Provider value={showChat}>
            <AssistantModeButton onOpen={onOpen} />
        </AnnaChatNavigationContext.Provider>
    )
    expect(component.root.findAllByType('AssistantAvatar')).toHaveLength(0)
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

it('uses only the panel icon for the sidebar close action while desktop chat is open', () => {
    const showChat = jest.fn()
    const closeChat = jest.fn()
    const component = renderer.create(
        <AnnaChatNavigationContext.Provider value={showChat}>
            <AnnaSidebarCloseContext.Provider value={closeChat}>
                <AssistantModeButton inline />
            </AnnaSidebarCloseContext.Provider>
        </AnnaChatNavigationContext.Provider>
    )

    expect(component.root.findAllByType('AssistantAvatar')).toHaveLength(0)
    const button = component.root.findByType(TouchableOpacity)
    expect(button.props.accessibilityLabel).toBe('Anna Alldone: Close assistant chat')
    act(() => button.props.onPress())
    expect(closeChat).toHaveBeenCalledTimes(1)
    expect(showChat).not.toHaveBeenCalled()
})

it.each([false, true])(
    'updates the selected assistant name without showing an avatar with the close action %s',
    expanded => {
        const action = expanded ? 'Close assistant chat' : 'Open assistant chat'
        const closeChat = expanded ? jest.fn() : null
        const button = () => (
            <AnnaSidebarCloseContext.Provider value={closeChat}>
                <AssistantModeButton />
            </AnnaSidebarCloseContext.Provider>
        )
        const component = renderer.create(button())
        mockState.defaultAssistant = { uid: 'mira', displayName: 'Mira', photoURL50: 'mira.png' }
        act(() => component.update(button()))
        expect(component.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe(`Mira: ${action}`)
        expect(component.root.findAllByType('AssistantAvatar')).toHaveLength(0)
        mockState.defaultAssistant = {
            ...mockState.defaultAssistant,
            displayName: 'Mira Coach',
            photoURL50: 'mira-new.png',
        }
        act(() => component.update(button()))
        expect(component.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe(`Mira Coach: ${action}`)
        expect(component.root.findAllByType('AssistantAvatar')).toHaveLength(0)
    }
)

it.each(['anonymous', 'missing assistant'])('hides the entry point for %s', state => {
    if (state === 'anonymous') mockState.loggedUser.isAnonymous = true
    else mockState.defaultAssistant = null
    expect(renderer.create(<AssistantModeButton />).toJSON()).toBeNull()
})
