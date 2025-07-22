import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import Header from './Header'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { colors } from '../../../styles/global'
import Line from '../GoalMilestoneModal/Line'
import Button from '../../../UIControls/Button'
import CurrentVersionItem from './CurrentVersionItem'
import VersionItem from './VersionItem'
import Backend from '../../../../utils/BackendBridge'
import { CONFIRM_POPUP_NOTE_REVISION_HISTORY } from '../../ConfirmPopup'
import { showConfirmPopup } from '../../../../redux/actions'
import { translate } from '../../../../i18n/TranslationService'

export const CURRENT_DAY_VERSION_ID = '-1'

export default function RevisionHistoryModal({ projectId, note, closeModal }) {
    const dispatch = useDispatch()
    const [selectedVersionId, setSelectedVersionId] = useState(note.versionId)
    const [noteVersions, setNoteVersions] = useState([])
    const [serverTimestamp, setServerTimestamp] = useState(0)

    const getSelectedNote = () => {
        if (selectedVersionId !== CURRENT_DAY_VERSION_ID) {
            for (let i = 0; i < noteVersions.length; i++) {
                const noteCopy = noteVersions[i]
                if (noteCopy.versionId === selectedVersionId) {
                    return noteCopy
                }
            }
        }
        return { versionId: CURRENT_DAY_VERSION_ID }
    }

    const openConfirmationModal = () => {
        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_NOTE_REVISION_HISTORY,
                object: {
                    projectId,
                    noteId: note.id,
                    restoredNoteVersion: getSelectedNote(),
                    currentNoteVersion: { ...note },
                },
            })
        )
        closeModal()
    }

    const updateNoteVersions = notesCopies => {
        notesCopies.sort(function (a, b) {
            if (a.versionDate > b.versionDate) {
                return -1
            }
            if (a.versionDate < b.versionDate) {
                return 1
            }
            return 0
        })
        setNoteVersions(notesCopies)
    }

    useEffect(() => {
        if (selectedVersionId !== CURRENT_DAY_VERSION_ID && noteVersions.length > 0) {
            for (let i = 0; i < noteVersions.length; i++) {
                const noteCopy = noteVersions[i]
                if (noteCopy.versionId === selectedVersionId) {
                    return
                }
            }
            setSelectedVersionId(CURRENT_DAY_VERSION_ID)
        }
    }, [noteVersions])

    useEffect(() => {
        Backend.getFirebaseTimestampDirectly().then(serverTimestamp => {
            setServerTimestamp(serverTimestamp)
        })
        Backend.watchNoteRevisionHistoryCopies(projectId, note.id, updateNoteVersions)
        return () => {
            Backend.unwatchNoteRevisionHistoryCopies()
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={{ paddingHorizontal: 16 }}>
                <Header
                    closeModal={closeModal}
                    title={translate('Select a version to recover')}
                    description={translate('Select a version to recover description')}
                />
            </View>
            <CurrentVersionItem
                note={note}
                isSelected={selectedVersionId === CURRENT_DAY_VERSION_ID}
                setSelectedVersionId={setSelectedVersionId}
                serverTimestamp={serverTimestamp}
                projectId={projectId}
            />
            <Line />
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                {noteVersions.map(note => {
                    return (
                        <VersionItem
                            key={note.versionId}
                            note={note}
                            isSelected={selectedVersionId === note.versionId}
                            setSelectedVersionId={setSelectedVersionId}
                            projectId={projectId}
                        />
                    )
                })}
            </CustomScrollView>
            <Line />
            <View style={localStyles.button}>
                <Button
                    icon={'rotate-ccw'}
                    iconColor={'#ffffff'}
                    type={'primary'}
                    onPress={openConfirmationModal}
                    shortcutText={'Enter'}
                    forceShowShortcut={true}
                    title={translate('Recover')}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        paddingVertical: 16,
        height: 548,
    },
    button: {
        flex: 1,
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    scroll: {
        height: 266,
    },
})
