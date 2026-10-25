import React, { useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import URLTrigger from '../../../URLSystem/URLTrigger'
import NavigationService from '../../../utils/NavigationService'
import Icon from '../../Icon'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import styles, { colors } from '../../styles/global'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import SaveButton from '../Common/SaveButton'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import { getPathname } from '../../Tags/LinkTag'
import { COMMENT_MODAL_ID, exitsOpenModals, TAGS_EDIT_OBJECT_MODAL_ID } from '../../ModalsManager/modalsManager'
import { updateArtifactMetadata } from '../../../utils/backends/Artifacts/artifactsFirestore'
import { showArtifactLinkAsPreview } from '../../ArtifactsView/artifactNoteEmbed'
import { translate } from '../../../i18n/TranslationService'

// The popup a link to an artifact opens inside a text: rename it in place or open it, and inside a
// note show it as a live preview card instead. Privacy and versions stay on the artifact itself,
// because only its owner may change who reads it.
export default function EditArtifactLink({
    projectId,
    containerStyle,
    artifactData,
    closeModal,
    objectUrl,
    editorRef,
    editorId,
    tagId,
}) {
    const artifactId = artifactData.id
    const initialTitle = artifactData.title || ''
    const [title, setTitle] = useState(initialTitle)
    const inputText = useRef()

    const cleanedTitle = title.trim()
    const needBeUpdated = () => cleanedTitle !== initialTitle.trim()

    const openDV = () => {
        closeModal()
        setTimeout(() => {
            const linkUrl =
                objectUrl != null ? getPathname(objectUrl) : `/projects/${projectId}/artifacts/${artifactId}`
            URLTrigger.processUrl(NavigationService, linkUrl)
        }, 400)
    }

    const updateArtifact = (openDetails = false) => {
        if (!cleanedTitle) return
        updateArtifactMetadata(projectId, artifactId, { title: cleanedTitle }).catch(error =>
            console.warn('[artifacts] rename from a link failed', { projectId, error })
        )
        openDetails ? openDV() : closeModal()
    }

    // Only offered where the chip lives in a note editor that can take the card.
    const canShowAsPreview = !!(editorRef && tagId && objectUrl)
    const showAsPreview = () => {
        const quill = editorRef?.getEditor?.()
        closeModal()
        showArtifactLinkAsPreview(quill, tagId, { url: objectUrl, title: cleanedTitle, editorId })
    }

    const enterKeyAction = () => {
        if (!exitsOpenModals([COMMENT_MODAL_ID, TAGS_EDIT_OBJECT_MODAL_ID])) {
            needBeUpdated() ? updateArtifact() : closeModal()
        }
    }

    return (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <Icon name={'layers'} size={24} color={'#ffffff'} style={localStyles.icon} />
                <View style={localStyles.inputWrapper}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={'Type to edit the artifact'}
                        placeholderTextColor={colors.Text03}
                        onChangeText={setTitle}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={initialTitle}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton
                        onPress={needBeUpdated() ? () => updateArtifact(true) : openDV}
                        disabled={!cleanedTitle}
                    />
                    {canShowAsPreview && (
                        <TouchableOpacity
                            testID="artifact-link-show-preview"
                            onPress={showAsPreview}
                            style={localStyles.previewButton}
                        >
                            <Icon name={'image'} size={18} color={'#ffffff'} />
                            <Text style={localStyles.previewText}>{translate('Show as preview')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
                <View style={localStyles.buttonsRight}>
                    <SaveButton
                        icon={(!needBeUpdated() || !cleanedTitle) && 'x'}
                        onPress={needBeUpdated() && cleanedTitle ? () => updateArtifact() : closeModal}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    inputWrapper: {
        marginTop: 2,
        marginBottom: 26,
        marginLeft: 28,
        minHeight: 38,
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
    previewButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    previewText: {
        ...styles.subtitle2,
        color: '#ffffff',
        marginLeft: 6,
    },
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
