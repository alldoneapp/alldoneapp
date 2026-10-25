import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native-web'
import LastEditionData from './LastEditionData'
import { setLanguage } from '../../i18n/TranslationService'

jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm:ss',
}))
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationDataInProject: () => ({ displayName: 'Karsten Wysk' }),
}))

const now = Date.UTC(2026, 9, 5, 10, 40, 53)
let tree
beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
})
afterEach(() => {
    if (tree) act(() => tree.unmount())
    jest.useRealTimers()
    setLanguage('en')
})

const renderMetadata = (language, age, views) => {
    setLanguage(language)
    act(() => {
        tree = renderer.create(
            <LastEditionData projectId="project" note={{ lastEditionDate: now - age, lastEditorId: 'user', views }} />
        )
    })
    return tree.root.findByType(Text).props.children
}

it.each([
    ['de', 'Geändert: 10:38:53 am 05.10.2026 • Karsten Wysk • 2 Aufrufe'],
    ['es', 'Última edición: 10:38:53 del 05.10.2026 • Karsten Wysk • 2 visualizaciones'],
    ['en', 'Edited: 10:38:53 on 05.10.2026 • Karsten Wysk • 2 views'],
])('localizes the note-list date, label and views in %s', (language, expected) => {
    expect(renderMetadata(language, 120000, 2)).toBe(expected)
})

it.each([
    ['de', 'Jetzt • Karsten Wysk • 1 Aufruf'],
    ['es', 'Justo ahora • Karsten Wysk • 1 visualización'],
    ['en', 'Just now • Karsten Wysk • 1 view'],
])('uses a localized recent-edit label for the first minute in %s', (language, expected) => {
    expect(renderMetadata(language, 59000, 1)).toBe(expected)
})
