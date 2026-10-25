import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native-web'
import { setLanguage } from '../i18n/TranslationService'
import DvTitleLayout from '../components/UIComponents/DvTitleLayout'
import Backend from '../utils/BackendBridge'

const mockNow = Date.UTC(2026, 9, 5, 10, 40, 53)
const mockState = { loggedUser: { language: 'de' }, isMiddleScreen: false, smallScreenNavigation: false }

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../utils/BackendBridge', () => ({ getFirebaseTimestampDirectly: jest.fn() }))
jest.mock('../components/UIComponents/FloatModals/DateFormatPickerModal', () => ({ getDateFormat: () => 'DD.MM.YYYY' }))
jest.mock('../components/Icon', () => 'Icon')

const layout = date => (
    <DvTitleLayout
        typeLabel="NOTE"
        typeIcon="file-text"
        lastEditionDate={date}
        editorName="Karsten Wysk"
        shortEditorName="Karsten"
    >
        <Text>Title</Text>
    </DvTitleLayout>
)
const visibleText = tree => tree.root.findAllByType(Text).map(node => node.props.children)
let tree

beforeEach(() => {
    jest.useFakeTimers()
    mockState.loggedUser.language = 'de'
    mockState.isMiddleScreen = false
    mockState.smallScreenNavigation = false
    setLanguage('de')
    Backend.getFirebaseTimestampDirectly.mockReset().mockResolvedValue(mockNow)
})

afterEach(() => {
    if (tree) act(() => tree.unmount())
    tree = null
    jest.useRealTimers()
    setLanguage('en')
})

it('reproduces the screenshot with the real hook and German translations', async () => {
    await act(async () => {
        tree = renderer.create(layout(mockNow - 10000))
    })
    expect(visibleText(tree)).toContain('Notiz')
    expect(visibleText(tree)).toContain('geändert vor 10 Sekunden von Karsten Wysk')
})

it('updates immediately when the language, timestamp or screen size changes', async () => {
    await act(async () => {
        tree = renderer.create(layout(mockNow - 10000))
    })
    mockState.loggedUser.language = 'es'
    setLanguage('es')
    await act(async () => {
        tree.update(layout(mockNow - 10000))
    })
    expect(visibleText(tree)).toContain('última edición 10 segundos atrás por Karsten Wysk')

    mockState.smallScreenNavigation = true
    await act(async () => {
        tree.update(layout(mockNow - 120000))
    })
    expect(visibleText(tree)).toContain('2m atrás por Karsten')

    setLanguage('de')
    mockState.loggedUser.language = 'de'
    mockState.smallScreenNavigation = false
    mockState.isMiddleScreen = true
    await act(async () => {
        tree.update(layout(mockNow - 10000))
    })
    expect(visibleText(tree)).toContain('geändert vor 10 Sek. von Karsten')
})

it('refreshes elapsed time and clears its interval on unmount', async () => {
    await act(async () => {
        tree = renderer.create(layout(mockNow - 10000))
    })
    Backend.getFirebaseTimestampDirectly.mockResolvedValue(mockNow + 1000)
    await act(async () => {
        jest.advanceTimersByTime(1000)
    })
    expect(visibleText(tree)).toContain('geändert vor 11 Sekunden von Karsten Wysk')
    act(() => tree.unmount())
    tree = null
    expect(jest.getTimerCount()).toBe(0)
})

it('ignores a stale server response after the timestamp changes', async () => {
    let resolveOld
    Backend.getFirebaseTimestampDirectly.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                resolveOld = resolve
            })
    )
    await act(async () => {
        tree = renderer.create(layout(mockNow - 10000))
    })
    await act(async () => {
        tree.update(layout(mockNow - 120000))
    })
    expect(visibleText(tree)).toContain('geändert vor 2 Minuten von Karsten Wysk')
    await act(async () => {
        resolveOld(mockNow)
    })
    expect(visibleText(tree)).toContain('geändert vor 2 Minuten von Karsten Wysk')
})
