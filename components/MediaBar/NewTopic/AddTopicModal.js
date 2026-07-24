import React, { useEffect, useRef } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import CustomScrollView from '../../UIControls/CustomScrollView'
import styles, { colors } from '../../styles/global'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { NEW_TOPIC_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import Hotkeys from 'react-hot-keys'
import Icon from '../../Icon'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import ButtonsContainer from './ButtonsContainer'
import useWindowSize from '../../../utils/useWindowSize'
import { getDefaultAssistantInProjectById } from '../../AdminPanel/Assistants/assistantsHelper'

export default function AddTopicModal({
    projectId,
    handleSubmit,
    onChangeText,
    text,
    setInputCursorIndex,
    setEditor,
    isPrivate,
    closeModal,
    setShowFileSelector,
    setShowPrivacyModal,
    initialDeltaOps,
    initialCursorIndex,
    onToggleBot,
    botIsActive,
}) {
    const mentionsModalActiveRef = useRef(false)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [width, height] = useWindowSize()

    const assistantId = getDefaultAssistantInProjectById(projectId)

    const setMentionsModalActive = value => {
        mentionsModalActiveRef.current = value
    }

    const enterKeyAction = event => {
        if (!mentionsModalActiveRef.current) {
            handleSubmit()
            if (event) event.preventDefault()
        }
    }

    const onKeyDown = event => {
        if (event.key === 'Enter') {
            enterKeyAction(event)
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [])

    return (
        <View
            style={[
                localStyles.parent,
                applyPopoverWidth(),
                { maxHeight: height - MODAL_MAX_HEIGHT_GAP },
                mobile && localStyles.mobile,
            ]}
        >
            <CustomScrollView style={localStyles.innerContainer2} showsVerticalScrollIndicator={false}>
                <View>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>New Topic</Text>
                    </View>
                    <View style={localStyles.container}>
                        <View style={localStyles.inputContainer}>
                            <CustomTextInput3
                                placeholder={'Add an update and @mention people you want to notify'}
                                placeholderTextColor={colors.Text03}
                                onChangeText={onChangeText}
                                multiline={true}
                                //fixedHeight={80}
                                inputHeight={72}
                                externalTextStyle={localStyles.textInputText}
                                caretColor="white"
                                autoFocus={true}
                                externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                                setMentionsModalActive={setMentionsModalActive}
                                initialTextExtended={text}
                                projectId={projectId}
                                styleTheme={NEW_TOPIC_MODAL_THEME}
                                setInputCursorIndex={setInputCursorIndex}
                                setEditor={setEditor}
                                initialDeltaOps={initialDeltaOps}
                                initialCursorIndex={initialCursorIndex}
                                otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat']}
                                forceTriggerEnterActionForBreakLines={enterKeyAction}
                            />
                        </View>
                        <ButtonsContainer
                            isPrivate={isPrivate}
                            text={text}
                            handleSubmit={handleSubmit}
                            setShowFileSelector={setShowFileSelector}
                            onToggleBot={onToggleBot}
                            botIsActive={botIsActive}
                            setShowPrivacyModal={setShowPrivacyModal}
                            projectId={projectId}
                            assistantId={assistantId}
                        />
                    </View>
                </View>
            </CustomScrollView>
            <View style={localStyles.closeContainer}>
                <Hotkeys keyName={'esc'} onKeyDown={(sht, event) => closeModal()} filter={e => true}>
                    <TouchableOpacity
                        accessibilityLabel={'social-text-block'}
                        style={localStyles.closeButton}
                        onPress={closeModal}
                    >
                        <Icon accessibilityLabel={'social-text-block'} name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        flex: 1,
        position: 'fixed',
        zIndex: 1,
        left: '48.5%',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        maxWidth: 305,
        minWidth: 305,
        height: 'auto',
        paddingHorizontal: 8,
        paddingVertical: 8,
        top: '50%',
        transform: [{ translateX: '-43%' }, { translateY: '-50%' }],
    },
    mobile: {
        transform: [{ translateX: '-48.5%' }, { translateY: '-50%' }],
    },
    innerContainer2: {
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: 13,
        right: 13,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 8,
        paddingHorizontal: 16,
        marginBottom: 8,
        minHeight: 72,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
})
