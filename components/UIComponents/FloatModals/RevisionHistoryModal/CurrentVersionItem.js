import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native'
import styles, { colors } from '../../../styles/global'
import SelectedAvatar from '../GoalAssigneesModal/SelectedAvatar'
import HelperFunctions from '../../../../utils/HelperFunctions'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { formatLastEditDate } from '../../../../i18n/relativeTime'
import { CURRENT_DAY_VERSION_ID } from './RevisionHistoryModal'
import { translate } from '../../../../i18n/TranslationService'

export default function CurrentVersionItem({ projectId, note, isSelected, setSelectedVersionId, serverTimestamp }) {
    const selectVersion = () => {
        setSelectedVersionId(CURRENT_DAY_VERSION_ID)
    }

    const { lastEditionDate, lastEditorId } = note
    const lastUserEditing = TasksHelper.getUserInProject(projectId, lastEditorId)
    const { displayName, photoURL } = lastUserEditing
    const name = HelperFunctions.getFirstName(displayName)

    const lastEdition = serverTimestamp
        ? formatLastEditDate(serverTimestamp, lastEditionDate, { relativeDays: true })
        : ''

    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.button} onPress={selectVersion}>
                {isSelected ? (
                    <SelectedAvatar photoURL={photoURL} />
                ) : (
                    <Image source={{ uri: photoURL }} style={localStyles.avatar} />
                )}
                <View style={localStyles.textContainer}>
                    <Text style={localStyles.versionText}>{translate('Current version from today')}</Text>
                    <Text style={localStyles.editionText}>
                        {translate('Name was last editor Edition', { name, lastEdition })}
                    </Text>
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 8,
    },
    button: {
        height: 56,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    avatar: {
        height: 32,
        width: 32,
        borderRadius: 100,
        marginRight: 8,
    },
    textContainer: {
        flexDirection: 'column',
    },
    versionText: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    editionText: {
        ...styles.caption2,
        color: colors.Text03,
    },
})
