import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import ReactQuill from 'react-quill'

import { colors } from '../../../styles/global'
import AddFeedAttachButton from '../../../Feeds/AddFeed/AddFeedAttachButton'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import GoogleMeetButton from './GoogleMeetButton'
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
    objectId,
    objectType,
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
                {false && !editing && <GoogleMeetButton title={chatTitle} members={members} projectId={projectId} />}
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
                        objectType={objectType}
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
    buttonContainer: {
        flex: 1,
        height: 55,
        flexDirection: 'row',
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
