import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import ReactQuill from 'react-quill-new'

import { colors } from '../../../styles/global'
import AddFeedAttachButton from '../../../Feeds/AddFeed/AddFeedAttachButton'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { insertAttachmentInsideEditor } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import { setQuotedText } from '../../../../redux/actions'
import BotButtonWrapper from './BotOption/BotButtonWrapper'
import SubmitButton from './SubmitButton'

const Delta = ReactQuill.Quill.import('delta')

export default function ChatInputButtons({
    projectId,
    chatTitle,
    members,
    onSubmit,
    inputText,
    inputCursorIndex,
    editor,
    initialText,
    editing,
    disabledEdition,
    closeEditMode,
    creatorId,
    inputRef,
    setShowRunOutGoalModal,
    showRunOutGoalModal,
    creatorData,
    assistantId,
    setAssistantId,
    objectId,
    objectType,
    assistantEnabled,
}) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
    }

    const onQuote = () => {
        const { displayName } = creatorData
        dispatch(setQuotedText({ text: inputText, userName: displayName }))
        closeEditMode()
    }

    const onSelectBotOption = optionText => {
        setTimeout(() => {
            if (optionText) {
                editor.setText(optionText)
                editor.setSelection(optionText.length)
            } else {
                editor.getSelection(true)
            }
        })
    }

    const onQuoteSelectedText = () => {
        const selection = editor.getSelection(true)

        let delta = new Delta()
        delta.retain(selection.index)
        delta.insert('[quote]')
        editor.updateContents(delta, 'user')

        delta = new Delta()
        delta.retain(selection.index + selection.length + '[quote]'.length)
        delta.insert('[quote]')
        editor.updateContents(delta, 'user')

        editor.setSelection(selection.index + selection.length + '[quote]'.length, 0, 'user')
    }

    const onClear = () => {
        inputRef.current.clear()
    }

    const sendButtonText = editing
        ? disabledEdition || initialText.trim() === inputText.trim()
            ? 'Ok'
            : 'Save'
        : 'Send'

    return (
        <View style={localStyles.buttonContainer}>
            <View style={[localStyles.buttonSection]}>
                {!disabledEdition && (
                    <AddFeedAttachButton
                        subscribeClickObserver={() => {}}
                        unsubscribeClickObserver={() => {}}
                        smallScreen
                        addAttachmentTag={addAttachmentTag}
                        projectId={projectId}
                    />
                )}
                <Hotkeys
                    keyName={'alt+Q'}
                    disabled={blockShortcuts}
                    onKeyDown={(sht, event) =>
                        execShortcutFn(this.quoteBtnRef, editing ? onQuote : onQuoteSelectedText, event)
                    }
                    filter={e => true}
                >
                    <Button
                        ref={ref => (this.quoteBtnRef = ref)}
                        type={'ghost'}
                        icon="previous-message-circle"
                        noBorder={true}
                        buttonStyle={{ marginRight: 4 }}
                        onPress={editing ? onQuote : onQuoteSelectedText}
                        shortcutText={'Q'}
                    />
                </Hotkeys>
                {!editing && (
                    <BotButtonWrapper
                        onSelectBotOption={onSelectBotOption}
                        objectId={objectId}
                        projectId={projectId}
                        assistantId={assistantId}
                        setAssistantId={setAssistantId}
                        objectType={objectType}
                        assistantEnabled={assistantEnabled}
                    />
                )}
            </View>
            <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                {!editing && (
                    <Hotkeys
                        keyName={'alt+C'}
                        disabled={blockShortcuts}
                        onKeyDown={(sht, event) => execShortcutFn(this.clearBtnRef, onClear, event)}
                        filter={e => true}
                    >
                        <Button
                            ref={ref => (this.clearBtnRef = ref)}
                            title={translate('Clear')}
                            type="secondary"
                            icon="clear-formatting"
                            onPress={onClear}
                            buttonStyle={{ marginRight: 4 }}
                            shortcutText={'C'}
                        />
                    </Hotkeys>
                )}
                <SubmitButton
                    onSubmit={onSubmit}
                    title={translate(sendButtonText)}
                    disabled={!inputText}
                    setShowRunOutGoalModal={setShowRunOutGoalModal}
                    showRunOutGoalModal={showRunOutGoalModal}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    // The action row is fixed chrome, not a flexible half of the composer: 1px top border
    // + 7px padding + a 40px button + 7px padding = 55.
    //
    // It used to say `flex: 1` next to `height: 55`, which is self-contradicting — in RN
    // `flex: 1` expands to `flexGrow: 1, flexShrink: 1, flexBasis: 0%`, so the declared 55
    // was never the row's size. The row simply took a SHARE of the composer card, and
    // since the text area above it is `flex: 1` too (CustomScrollView), the two split the
    // card in half: typing a second line grew the grey band to 69px, a third to 86px, six
    // to 137px, with the buttons left at the top and a growing empty band beneath them.
    // In the other direction — a card whose height is pinned while the text area holds its
    // own minimum — the same share arithmetic squeezed the row BELOW its content, and
    // because react-native-web's base `View` sets `min-height: 0` there is no
    // content-based floor to stop it: the 40px buttons then hung out of the 36px band and
    // past the bottom of the card. That is the screenshot on AT-2438.
    //
    // Rigid (`flexGrow: 0, flexShrink: 0`) makes the row exactly its own content in every
    // layout, and leaves the text area — which has `minHeight: 40` and can flex — as the
    // part that gives way. `minHeight` rather than `height` so a taller control or a
    // wrapped label grows the band instead of being clipped by it.
    buttonContainer: {
        flexGrow: 0,
        flexShrink: 0,
        minHeight: 55,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 7,
        paddingHorizontal: 9,
    },
    buttonSection: {
        flexDirection: 'row',
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    icon: {
        position: 'absolute',
        padding: 0,
        margin: 0,
        left: 15,
        top: 7,
    },
})
