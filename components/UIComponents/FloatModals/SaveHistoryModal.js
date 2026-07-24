import React, { useState, useEffect, useRef } from 'react'
import { StyleSheet, View, TextInput, Text } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import ModalHeader from './ModalHeader'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import Backend from '../../../utils/BackendBridge'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'
import { translate } from '../../../i18n/TranslationService'

export const CURRENT_DAY_VERSION_ID = '-1'

export default function SaveHistoryModal({ projectId, note, closeModal }) {
    const dispatch = useDispatch()
    const [versionName, setVersionName] = useState('')
    const inputText = useRef(null)

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

    const saveVersion = async () => {
        closeModal()
        const paths = getPaths()
        dispatch(startLoadingData())
        await Backend.saveNoteCopy(projectId, note, versionName, paths)
        dispatch(stopLoadingData())
    }

    const onKeyDown = event => {
        if (event.key === 'Enter') {
            if (versionName) {
                saveVersion()
            } else if (inputText.current.isFocused()) {
                setTimeout(() => {
                    inputText.current.focus()
                })
            }
        }
    }

    useEffect(() => {
        inputText.current.focus()
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <ModalHeader
                closeModal={closeModal}
                title={translate('Save to version history')}
                description={translate(
                    'By saving, the current state of this note will be saved as a version in history'
                )}
            />
            <Text style={localStyles.nameText}>{translate('Version name')}</Text>
            <TextInput
                ref={inputText}
                style={localStyles.commentBox}
                placeholder={translate('Type version name')}
                placeholderTextColor={colors.Text03}
                value={versionName}
                onChangeText={text => setVersionName(text)}
                autoFocus={true}
            />
            <View style={localStyles.button}>
                <Button
                    type={'primary'}
                    onPress={saveVersion}
                    shortcutText={'Enter'}
                    forceShowShortcut={true}
                    title={translate('Save Note')}
                    disabled={!versionName}
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
        height: 244,
        paddingHorizontal: 16,
    },
    nameText: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 22,
        color: colors.Text02,
    },
    commentBox: {
        ...styles.body1,
        color: 'white',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Gray400,
        paddingHorizontal: 15,
        paddingVertical: 7,
        marginTop: 4,
        marginBottom: 16,
    },
    button: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
