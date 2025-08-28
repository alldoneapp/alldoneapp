import React, { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import RecordVideo from '../../MediaBar/RecordVideo/RecordVideo'
import ScreenRecording from '../../MediaBar/ScreenRecording/ScreenRecording'
import MyPlatform from '../../MyPlatform'
import NotAvailableScreenRecording from '../../MediaBar/ScreenRecording/NotAvailableScreenRecording'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { translate } from '../../../i18n/TranslationService'

export default function AttachmentsSelectorModal({ projectId, closeModal, addAttachmentTag, style }) {
    const [width, height] = useWindowSize()
    const [showVideoRecorder, setShowVideoRecorder] = useState(false)
    const [showScreenRecorder, setShowScreenRecorder] = useState(false)
    const [showMessage, setShowMessage] = useState(false)
    const limit = 50

    const chooseAttachments = () => {
        if (Platform.OS === 'web') {
            let fileInput = document.getElementById('file-input')

            fileInput.onchange = event => {
                const file = event.target.files[0]
                const fileSize = file.size / 1024 / 1024 // in MB
                if (fileSize > limit) {
                    alert(translate('File size exceeds', { limit, size: fileSize.toFixed(2) }))
                } else {
                    const { name } = file
                    const uri = URL.createObjectURL(file)
                    addAttachmentTag(name.replaceAll(/\s/g, '_'), uri)
                }
                setTimeout(() => {
                    closeModal()
                }, 100)
            }
            fileInput.click()
        }
    }

    const openVideoRecorder = () => {
        setShowVideoRecorder(true)
    }

    const openScreenRecorder = () => {
        if (MyPlatform.isDesktop) {
            setShowScreenRecorder(true)
        } else {
            setShowMessage(true)
        }
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Escape') {
            closeModal()
        }
    }

    const getVideo = file => {
        const { name } = file
        const uri = URL.createObjectURL(file)
        addAttachmentTag(name.replaceAll(/\s/g, '_'), uri)

        setTimeout(() => {
            closeModal()
        }, 100)
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [])

    return showVideoRecorder ? (
        <RecordVideo projectId={projectId} setVideoToExternalParent={getVideo} closeModal={closeModal} />
    ) : showScreenRecorder ? (
        <ScreenRecording projectId={projectId} setVideoToExternalParent={getVideo} closeModal={closeModal} />
    ) : showMessage ? (
        <NotAvailableScreenRecording onPress={() => setShowMessage(false)} />
    ) : (
        <View
            style={[
                localStyles.container,
                applyPopoverWidth(),
                { maxHeight: height - MODAL_MAX_HEIGHT_GAP },
                style ? style : null,
            ]}
        >
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <Text style={localStyles.headerText}>{translate('Select kind of file to add')}</Text>
                <Text style={localStyles.descriptionText}>
                    {translate('Here you can select a file from storage device or add a quick video or audio')}
                </Text>
                <SelectionCell text="File or image" ico="folder-plus" onPress={chooseAttachments} />
                <input id="file-input" type="file" hidden />
                <SelectionCell text="Record a video" ico="add-video" onPress={openVideoRecorder} />
                {/*<SelectionCell text="Record an audio" ico="mic" />*/}
                <SelectionCell text="Screen recording" ico="screen-recording" onPress={openScreenRecorder} />
                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={closeModal}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
        </View>
    )
}

function SelectionCell({ onPress, text, ico }) {
    return (
        <TouchableOpacity style={localStyles.cellContainer} onPress={onPress}>
            <Icon size={24} name={ico} color="#ffffff" />
            <Text style={localStyles.cellText}>{translate(text)}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    headerText: {
        ...styles.title7,
        color: '#ffffff',
    },
    descriptionText: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 20,
    },
    cellContainer: {
        flexDirection: 'row',
        height: 40,
        alignContent: 'center',
        alignItems: 'center',
    },
    cellText: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
        minHeight: 40,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
