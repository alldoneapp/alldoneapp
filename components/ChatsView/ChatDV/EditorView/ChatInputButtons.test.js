/**
 * @jest-environment jsdom
 *
 * AT-2438 regression, style-contract half.
 *
 * "the buttons below the input field seem to not fit fully into the background ..
 *  background row has a wrong size"
 *
 * The action row is fixed chrome — 1px top border + 7px padding + a 40px button + 7px
 * padding — but it was declared `{ flex: 1, height: 55 }`. In React Native `flex: 1`
 * expands to `flexGrow: 1, flexShrink: 1, flexBasis: 0%`, so the 55 was never the row's
 * size: the row took a SHARE of the composer card, and since the text area above it is
 * `flex: 1` too, the two split the card in half. Typing grew the grey band line for line
 * with the text, and a card whose height was pinned squeezed the band BELOW its own
 * buttons — react-native-web's base `View` sets `min-height: 0`, so nothing stops that —
 * leaving the buttons hanging out of the band and past the bottom of the card.
 *
 * jsdom has no layout, so the geometry itself is pinned in real Chromium by
 * `browser-tests/at2438/run.js` (6 viewports x 3 languages x 5 content lengths). What is
 * pinned HERE is the declaration that geometry rests on, because this is the half that
 * runs in CI: the row must not be able to grow or shrink.
 */
import React from 'react'
import renderer from 'react-test-renderer'
import { StyleSheet, View } from 'react-native'

import ChatInputButtons from './ChatInputButtons'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: () => false,
}))

jest.mock('react-quill-new', () => ({
    Quill: {
        import: () =>
            function Delta() {
                this.retain = jest.fn(() => this)
                this.insert = jest.fn(() => this)
            },
    },
}))

jest.mock('react-hot-keys', () => {
    const React = require('react')
    return ({ children }) => <>{children}</>
})

jest.mock('../../../Feeds/AddFeed/AddFeedAttachButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    return () => <View testID="attach-button" style={{ height: 40 }} />
})

jest.mock('../../../UIControls/Button', () => {
    const React = require('react')
    const { View } = require('react-native')
    // The real Button is `height: 40, minHeight: 40` (components/UIControls/Button.js);
    // that height is what has to fit inside the row.
    return React.forwardRef((props, ref) => <View testID={`button-${props.icon}`} style={{ height: 40 }} />)
})

jest.mock('./BotOption/BotButtonWrapper', () => {
    const React = require('react')
    const { View } = require('react-native')
    return () => <View testID="bot-button" style={{ height: 40 }} />
})

jest.mock('./SubmitButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    return () => <View testID="submit-button" style={{ height: 40 }} />
})

jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    insertAttachmentInsideEditor: jest.fn(),
}))

jest.mock('../../../../utils/HelperFunctions', () => ({ execShortcutFn: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({ setQuotedText: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../styles/global', () => ({
    colors: { Grey100: '#FAFBFB', Gray300: '#E7ECEF' },
}))

// 1px top border + 7px padding + a 40px button + 7px padding.
const ROW_BORDER = 1
const ROW_PADDING = 7
const BUTTON_HEIGHT = 40

const renderRow = (props = {}) =>
    renderer.create(
        <ChatInputButtons
            projectId="project-1"
            chatTitle="A topic"
            members={[]}
            onSubmit={jest.fn()}
            inputText=""
            inputCursorIndex={0}
            editor={{}}
            initialText=""
            editing={false}
            disabledEdition={false}
            closeEditMode={jest.fn()}
            creatorId="user-1"
            inputRef={{ current: { clear: jest.fn() } }}
            setShowRunOutGoalModal={jest.fn()}
            showRunOutGoalModal={false}
            creatorData={{ displayName: 'User' }}
            assistantId={null}
            setAssistantId={jest.fn()}
            objectId="chat-1"
            objectType="topics"
            assistantEnabled={false}
            {...props}
        />
    )

const rowStyle = props => StyleSheet.flatten(renderRow(props).root.findAllByType(View)[0].props.style)

describe('the composer action row is fixed chrome (AT-2438)', () => {
    it('cannot grow — it must not take a share of the composer card', () => {
        const style = rowStyle()

        expect(style.flexGrow).toBe(0)
        // `flex` is the trap: `flex: 1` silently reintroduces grow AND shrink AND
        // flexBasis: 0%, which is exactly what made the declared height meaningless.
        expect(style.flex).toBeUndefined()
    })

    it('cannot shrink below its own buttons', () => {
        const style = rowStyle()

        // react-native-web's base View sets `min-height: 0`, so flexShrink is the only
        // thing standing between the band and its 40px buttons.
        expect(style.flexShrink).toBe(0)
    })

    it('reserves exactly the room its buttons need', () => {
        const style = rowStyle()

        expect(style.minHeight).toBe(ROW_BORDER + ROW_PADDING * 2 + BUTTON_HEIGHT)
        expect(style.borderTopWidth).toBe(ROW_BORDER)
        expect(style.paddingVertical).toBe(ROW_PADDING)
        // A fixed `height` would clip a taller control or a wrapped label instead of
        // letting the band grow with it.
        expect(style.height).toBeUndefined()
    })

    it('centres its buttons in the band', () => {
        expect(rowStyle().alignItems).toBe('center')
    })

    it('keeps its two button groups pushed to opposite ends', () => {
        // Unchanged by the fix, asserted so the layout swap cannot quietly drop it.
        expect(rowStyle().flexDirection).toBe('row')
        expect(rowStyle().justifyContent).toBe('space-between')
    })

    it('holds the same band while editing, when the Clear button is gone', () => {
        // Editing renders one button fewer on the right; the chrome must not resize.
        expect(rowStyle({ editing: true }).minHeight).toBe(ROW_BORDER + ROW_PADDING * 2 + BUTTON_HEIGHT)
        expect(rowStyle({ editing: true }).flexShrink).toBe(0)
    })
})
