import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native'
import styles, { colors } from '../../../styles/global'
import SelectedAvatar from '../GoalAssigneesModal/SelectedAvatar'
import HelperFunctions from '../../../../utils/HelperFunctions'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import moment from 'moment'
import { CURRENT_DAY_VERSION_ID } from './RevisionHistoryModal'
import { translate } from '../../../../i18n/TranslationService'

export default function CurrentVersionItem({ projectId, note, isSelected, setSelectedVersionId, serverTimestamp }) {
    const parseLastEditionTime = timestamp => {
        var text = ''

        if (serverTimestamp) {
            const today = moment(serverTimestamp)
            const lastEdit = moment(timestamp)

            const secondsDiff = today.diff(lastEdit, 'seconds')
            if (secondsDiff < 60) {
                text =
                    secondsDiff === 1
                        ? translate('1 second ago')
                        : translate(`Amount seconds ago`, { amount: secondsDiff })
            } else {
                const minutesDiff = today.diff(lastEdit, 'minutes')
                if (minutesDiff < 60) {
                    text =
                        minutesDiff === 1
                            ? translate('1 minute ago')
                            : translate(`Amount minutes ago`, { amount: minutesDiff })
                } else {
                    const hoursDiff = today.diff(lastEdit, 'hours')
                    if (hoursDiff < 24) {
                        text =
                            hoursDiff === 1
                                ? translate('1 hour ago')
                                : translate(`Amount hours ago`, { amount: hoursDiff })
                    } else {
                        const daysDiff = today.diff(lastEdit, 'days')
                        text =
                            daysDiff === 1 ? translate('1 day ago') : translate(`Amount days ago`, { amount: daysDiff })
                    }
                }
            }
        }
        return text
    }

    const selectVersion = () => {
        setSelectedVersionId(CURRENT_DAY_VERSION_ID)
    }

    const { lastEditionDate, lastEditorId } = note
    const lastUserEditing = TasksHelper.getUserInProject(projectId, lastEditorId)
    const { displayName, photoURL } = lastUserEditing
    const name = HelperFunctions.getFirstName(displayName)

    const lastEdition = parseLastEditionTime(lastEditionDate)

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
