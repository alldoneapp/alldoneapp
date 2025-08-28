import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import { useDispatch } from 'react-redux'

import styles, { em2px, colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { generatorParserCustomElement, generatorParserTextElement } from '../../../Feeds/Utils/HelperFunctions'
import MultilineParser from '../../../Feeds/TextParser/MultilineParser'
import { hideConfirmPopup } from '../../../../redux/actions'
import { CURRENT_DAY_VERSION_ID } from './RevisionHistoryModal'
import Backend from '../../../../utils/BackendBridge'
import Button from '../../../UIControls/Button'
import { goToObjectDetailView, goToObjectNoteView } from '../../../GlobalSearchAlgolia/searchFunctions'

export default function RevisionHistoryConfirmationModal({
    projectId,
    noteId,
    restoredNoteVersion,
    currentNoteVersion,
}) {
    const dispatch = useDispatch()
    const [processing, setProcessing] = useState(false)

    const getPaths = () => {
        const notesPaths = {
            noteItems: 'noteItems',
            notesData: 'notesData',
            noteItemsVersions: 'noteItemsVersions',
            noteVersionsData: 'noteVersionsData',
            noteItemsDailyVersions: 'noteItemsDailyVersions',
            noteDailyVersionsData: 'noteDailyVersionsData',
        }
        return notesPaths
    }

    const closeModal = () => {
        dispatch(hideConfirmPopup())
    }

    const restoreNoteVersion = async () => {
        setProcessing(true)
        const paths = getPaths()
        const { parentObject } = currentNoteVersion
        if (currentNoteVersion.versionId === CURRENT_DAY_VERSION_ID) {
            if (currentNoteVersion.versionId !== restoredNoteVersion.versionId) {
                await Backend.createDailyNoteCopy(projectId, noteId, currentNoteVersion, paths)
                await Backend.restoreNoteCopy(projectId, noteId, restoredNoteVersion, paths)
            }
        } else {
            if (restoredNoteVersion.versionId === CURRENT_DAY_VERSION_ID) {
                await Backend.restoreDailyNoteCopy(projectId, noteId, paths)
            } else {
                await Backend.restoreNoteCopy(projectId, noteId, restoredNoteVersion, paths)
            }
        }
        parentObject
            ? goToObjectNoteView(projectId, parentObject)
            : goToObjectDetailView(projectId, noteId, 'notes', 'note')
        closeModal()
    }

    const parseFeed = () => {
        const elementsData = []

        const icon = generatorParserCustomElement(
            <Icon style={{ marginTop: 2, marginRight: 4 }} name="info" size={18} color={colors.Text03} />
        )
        elementsData.push(icon)

        const description =
            'Recovering this version will overwrite the current version. However you can always switch back to the previous version if you want to.'
        const text = generatorParserTextElement([localStyles.description, { overflow: 'hidden' }], description)
        elementsData.push(text)

        return elementsData
    }

    const elementsData = parseFeed()
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.title}>Important info</Text>
            <MultilineParser elementsData={elementsData} externalContainerStyle={localStyles.descriptionContainer} />
            <View style={localStyles.buttonsContainer}>
                <TouchableOpacity
                    style={[localStyles.button, localStyles.cancelButton]}
                    onPress={closeModal}
                    disabled={processing}
                >
                    <Text style={[localStyles.buttonText, localStyles.cancelButtonText]}>Cancel</Text>
                </TouchableOpacity>
                <Button
                    type={'ghost'}
                    processingTitle={'Proceed'}
                    title={'Proceed'}
                    onPress={restoreNoteVersion}
                    noBorder={true}
                    titleStyle={[localStyles.buttonText, localStyles.proceedButtonText]}
                    buttonStyle={[localStyles.button, localStyles.proceedButton]}
                    processing={processing}
                    disabled={processing}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 317,
        height: 206,
        backgroundColor: '#091540',
        padding: 16,
        borderRadius: 4,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${32}px rgba(0,0,0,0.04), ${0}px ${16}px ${24}px rgba(0, 0, 0, 0.04)`,
            },
        }),
    },
    title: {
        ...styles.title7,
        color: '#FFFFFF',
        fontWeight: '500',
    },
    descriptionContainer: {
        paddingRight: 0,
        marginLeft: 0,
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginLeft: 4,
    },
    buttonsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    button: {
        borderRadius: 4,
        marginTop: 20,
        paddingHorizontal: 16,
        paddingVertical: 13,
    },
    cancelButton: {
        backgroundColor: '#EAF0F5',
        marginRight: 8,
    },
    proceedButton: {
        backgroundColor: colors.Primary300,
    },
    buttonText: {
        fontFamily: 'Roboto-regular',
        fontWeight: '500',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
    },
    cancelButtonText: {
        color: colors.Text01,
    },
    proceedButtonText: {
        color: '#FFFFFF',
    },
})
