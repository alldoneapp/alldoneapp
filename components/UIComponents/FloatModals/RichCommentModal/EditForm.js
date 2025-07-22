import React, { Component } from 'react'
import { StyleSheet, View } from 'react-native'
import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import {
    COMMENT_MODAL_THEME,
    updateKarmaInInput,
    checkIfInputHaveKarma,
} from '../../../Feeds/CommentsTextInput/textInputHelper'
import { MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import Hotkeys from 'react-hot-keys'
import store from '../../../../redux/store'
import { translate } from '../../../../i18n/TranslationService'
import BotButtonWrapper from '../../../ChatsView/ChatDV/EditorView/BotOption/BotButtonWrapper'
import SubmitButton from './SubmitButton'

export default class EditForm extends Component {
    constructor(props) {
        super(props)

        const { currentComment, currentMentions, currentKarma, currentPrivacy } = this.props

        this.state = {
            comment: currentComment || '',
            mentions: currentMentions || [],
            hasKarma: currentKarma || false,
            isPrivate: currentPrivacy || false,
            mentionsModalActive: false,
            isShiftPressed: false,
        }

        this.inputTask = React.createRef()
    }

    componentDidMount() {
        document.addEventListener('keydown', this.onKeyDown)
        document.addEventListener('keyup', this.onKeyUp)
    }

    blur = () => {
        this.inputTask?.current?.blur()
    }

    focus = () => {
        this.inputTask?.current?.focus()
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onKeyDown)
        document.removeEventListener('keyup', this.onKeyUp)
    }

    onKeyDown = event => {
        const { disableDoneButton } = this.props
        const { isShiftPressed, mentionsModalActive, comment } = this.state
        const { isQuillTagEditorOpen, openModals } = store.getState()
        const { key } = event
        if (
            key === 'Enter' &&
            !isShiftPressed &&
            !mentionsModalActive &&
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID] &&
            !disableDoneButton &&
            comment.trim()
        ) {
            this.done()
            event.preventDefault()
        }
        if (key === 'Shift') {
            this.setState({ isShiftPressed: true })
        }
    }

    onKeyUp = ({ key }) => {
        if (key === 'Shift') {
            this.setState({ isShiftPressed: false })
        }
    }

    setMentionsModalActive = value => {
        this.setState({ mentionsModalActive: value })
    }

    onSelectBotOption = optionText => {
        const { editor } = this.props
        if (editor) {
            setTimeout(() => {
                if (optionText) {
                    editor.setText(optionText)
                    editor.setSelection(optionText.length)
                } else {
                    editor.getSelection(true)
                }
            })
        }
    }

    setComment = value => {
        const { editor, setInitialComment } = this.props

        if (editor) {
            const hasKarma = checkIfInputHaveKarma(editor)
            this.setState({ comment: value, hasKarma })
        } else {
            this.setState({ comment: value })
        }
        setInitialComment(value)
    }

    setPrivacy = value => {
        this.setState({ isPrivate: value })
    }

    setKarma = () => {
        const { editor, initialCursorIndex, userGettingKarmaId } = this.props
        updateKarmaInInput(userGettingKarmaId, editor, initialCursorIndex)
    }

    done = () => {
        const { comment, mentions, isPrivate, hasKarma } = this.state
        const { onSuccess } = this.props

        const data = {
            comment: comment.trim(),
            mentions: mentions,
            privacy: isPrivate,
            hasKarma: hasKarma,
        }
        if (onSuccess != null) onSuccess(data)
    }

    render() {
        const { isPrivate, hasKarma, comment } = this.state
        const {
            projectId,
            currentComment,
            containerStyle,
            toggleShowFileSelector,
            setEditor,
            setInputCursorIndex,
            initialCursorIndex,
            initialDeltaOps,
            userGettingKarmaId,
            objectType,
            hideDoneButton,
            userIsAnonymous,
            showBotButton,
            setShowRunOutGoalModal,
            showRunOutGoalModal,
            objectId,
            characterLimit,
            disableDoneButton,
            assistantId,
            chatAssistantData,
            setAssistantId,
        } = this.props

        return (
            <View style={[localStyles.container, containerStyle]}>
                <View style={localStyles.inputContainer}>
                    <View style={{ marginBottom: 8, minHeight: 38 }}>
                        <CustomTextInput3
                            ref={this.inputTask}
                            placeholder={translate('Type to add a comment')}
                            placeholderTextColor={colors.Text03}
                            onChangeText={this.setComment}
                            multiline={true}
                            externalTextStyle={localStyles.textInputText}
                            caretColor="white"
                            autoFocus={true}
                            externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                            setMentionsModalActive={this.setMentionsModalActive}
                            initialTextExtended={currentComment}
                            projectId={projectId}
                            styleTheme={COMMENT_MODAL_THEME}
                            setEditor={setEditor}
                            setInputCursorIndex={setInputCursorIndex}
                            initialCursorIndex={initialCursorIndex}
                            initialDeltaOps={initialDeltaOps}
                            otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat', 'karma']}
                            disabledEdition={userIsAnonymous}
                            characterLimit={characterLimit}
                            setShowRunOutGoalModal={setShowRunOutGoalModal}
                            chatAssistantData={chatAssistantData}
                            setAssistantId={setAssistantId}
                            externalEditorId={`${projectId}AddComment`}
                        />
                    </View>
                </View>
                <View style={localStyles.buttonsContainer}>
                    <View style={localStyles.buttonsLeft}>
                        {userGettingKarmaId ? (
                            <Hotkeys
                                keyName={'alt+1'}
                                onKeyDown={this.setKarma}
                                disabled={userIsAnonymous}
                                filter={e => true}
                            >
                                <Button
                                    icon={hasKarma ? 'thumbs-up-checked' : 'thumbs-up'}
                                    iconColor={colors.Text04}
                                    buttonStyle={{ backgroundColor: colors.Secondary200, marginRight: 4 }}
                                    onPress={this.setKarma}
                                    shortcutText={'1'}
                                    forceShowShortcut={true}
                                    disabled={userIsAnonymous}
                                />
                            </Hotkeys>
                        ) : null}
                        <Hotkeys
                            keyName={'alt+u'}
                            onKeyDown={toggleShowFileSelector}
                            disabled={userIsAnonymous}
                            filter={e => true}
                        >
                            <Button
                                icon={'folder-plus'}
                                iconColor={colors.Text04}
                                buttonStyle={{ backgroundColor: colors.Secondary200, marginRight: 4 }}
                                onPress={toggleShowFileSelector}
                                shortcutText={'U'}
                                forceShowShortcut={true}
                                disabled={userIsAnonymous}
                            />
                        </Hotkeys>
                        {objectType !== 'goals' && (
                            <Hotkeys
                                keyName={'alt+p'}
                                onKeyDown={() => this.setPrivacy(!isPrivate)}
                                disabled={userIsAnonymous}
                                filter={e => true}
                            >
                                <Button
                                    icon={isPrivate ? 'lock' : 'unlock'}
                                    iconColor={colors.Text04}
                                    buttonStyle={{ backgroundColor: colors.Secondary200, marginRight: 4 }}
                                    onPress={() => this.setPrivacy(!isPrivate)}
                                    shortcutText={'P'}
                                    forceShowShortcut={true}
                                    disabled={userIsAnonymous}
                                />
                            </Hotkeys>
                        )}
                        {showBotButton && !userIsAnonymous && (
                            <BotButtonWrapper
                                onSelectBotOption={this.onSelectBotOption}
                                inModal={true}
                                objectId={objectId}
                                projectId={projectId}
                                assistantId={assistantId}
                                objectType={objectType}
                                setAssistantId={setAssistantId}
                            />
                        )}
                    </View>
                    {!hideDoneButton && (
                        <View style={localStyles.buttonsRight}>
                            <SubmitButton
                                onSubmit={this.done}
                                disabled={userIsAnonymous || disableDoneButton || !comment.trim()}
                                setShowRunOutGoalModal={setShowRunOutGoalModal}
                                showRunOutGoalModal={showRunOutGoalModal}
                            />
                        </View>
                    )}
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 3,
        paddingBottom: 5,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
    buttonsRight: {},
})
