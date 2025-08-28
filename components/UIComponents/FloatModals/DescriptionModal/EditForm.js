import React, { Component } from 'react'
import { StyleSheet, View } from 'react-native'
import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import Hotkeys from 'react-hot-keys'
import store from '../../../../redux/store'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'

export default class EditForm extends Component {
    constructor(props) {
        super(props)

        const { currentDescription } = this.props

        this.state = {
            description: currentDescription || '',
            mentionsModalActive: false,
        }

        this.inputRef = React.createRef()
    }

    componentDidMount() {
        document.addEventListener('keydown', this.onKeyDown)
        document.addEventListener('keyup', this.onKeyUp)
    }

    focus = () => {
        this.inputRef?.current?.focus()
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onKeyDown)
        document.removeEventListener('keyup', this.onKeyUp)
    }

    onKeyDown = event => {
        const { mentionsModalActive } = this.state
        const { isQuillTagEditorOpen, openModals } = store.getState()
        const { key } = event
        if (
            key === 'Enter' &&
            !event.shiftKey &&
            !mentionsModalActive &&
            !isQuillTagEditorOpen &&
            !openModals[MENTION_MODAL_ID]
        ) {
            this.done()
            event.preventDefault()
        }
    }

    setMentionsModalActive = value => {
        this.setState({ mentionsModalActive: value })
    }

    setDescription = value => {
        this.setState({ description: value })
    }

    done = () => {
        const { description } = this.state
        const { onSuccess } = this.props

        if (onSuccess != null) onSuccess(description.trim())
    }

    render() {
        const {
            projectId,
            currentDescription,
            containerStyle,
            toggleShowFileSelector,
            setEditor,
            setInputCursorIndex,
            initialCursorIndex,
            initialDeltaOps,
            enableAttachments,
            userIsAnonymous,
            isCalendarTask,
            disabledTags,
            externalEditorId,
        } = this.props

        return (
            <View style={[localStyles.container, containerStyle]}>
                <CustomScrollView style={localStyles.inputContainer} showsVerticalScrollIndicator={false}>
                    <View style={{ marginBottom: 8, minHeight: 38 }}>
                        <CustomTextInput3
                            ref={this.inputRef}
                            placeholder={translate('Type to add a description')}
                            placeholderTextColor={colors.Text03}
                            onChangeText={this.setDescription}
                            multiline={true}
                            externalTextStyle={localStyles.textInputText}
                            caretColor="white"
                            autoFocus={true}
                            externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                            setMentionsModalActive={this.setMentionsModalActive}
                            initialTextExtended={currentDescription}
                            projectId={projectId}
                            styleTheme={COMMENT_MODAL_THEME}
                            setEditor={setEditor}
                            setInputCursorIndex={setInputCursorIndex}
                            initialCursorIndex={initialCursorIndex}
                            initialDeltaOps={initialDeltaOps}
                            keepBreakLines={true} // this allow to keep the break lines on initial load or pasted content
                            otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat']}
                            isCalendarTask={isCalendarTask}
                            disabledEdition={userIsAnonymous || isCalendarTask}
                            disabledTags={disabledTags}
                            externalEditorId={externalEditorId}
                        />
                    </View>
                </CustomScrollView>
                <View style={localStyles.buttonsContainer}>
                    <View style={localStyles.buttonsLeft}>
                        {enableAttachments && (
                            <Hotkeys keyName={'alt+u'} onKeyDown={toggleShowFileSelector} filter={e => true}>
                                <Button
                                    icon={'folder-plus'}
                                    iconColor={colors.Text04}
                                    buttonStyle={{ backgroundColor: colors.Secondary200, marginRight: 4 }}
                                    onPress={toggleShowFileSelector}
                                    shortcutText={'U'}
                                    forceShowShortcut={true}
                                    disabled={userIsAnonymous || isCalendarTask}
                                />
                            </Hotkeys>
                        )}
                    </View>
                    <View style={localStyles.buttonsRight}>
                        <Button
                            icon={'save'}
                            iconColor={'#ffffff'}
                            type={'primary'}
                            onPress={this.done}
                            shortcutText={'Enter'}
                            forceShowShortcut={true}
                            disabled={userIsAnonymous || isCalendarTask}
                        />
                    </View>
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
        maxHeight: 200,
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
