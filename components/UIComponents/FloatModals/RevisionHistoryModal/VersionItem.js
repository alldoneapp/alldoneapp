import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native'
import moment from 'moment'

import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import SelectedAvatar from '../GoalAssigneesModal/SelectedAvatar'
import HelperFunctions from '../../../../utils/HelperFunctions'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { getDateFormat, getTimeFormat } from '../DateFormatPickerModal'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import { translate } from '../../../../i18n/TranslationService'

export default function VersionItem({ projectId, note, isSelected, setSelectedVersionId }) {
    const selectVersion = () => {
        setSelectedVersionId(note.versionId)
    }

    const { versionDate, versionName, lastEditorId } = note

    const lastUserEditing = TasksHelper.getUserInProject(projectId, lastEditorId)
    const name = lastUserEditing ? HelperFunctions.getFirstName(lastUserEditing.displayName) : translate('Deleted user')

    const vDate = moment(versionDate)
    const vDateBerlin = vDate.tz('Europe/Berlin').format(getDateFormat())
    const versionText = versionName ? versionName : translate(`Version from Date`, { date: vDateBerlin })
    const creationTime = moment(versionDate).format(getTimeFormat())
    const editionText = translate(`Name was last editor • Date Time`, { name, date: vDateBerlin, time: creationTime })

    return (
        <View style={localStyles.container}>
            <TouchableOpacity
                style={[localStyles.button, isSelected && localStyles.selectedBackground]}
                onPress={selectVersion}
            >
                {isSelected ? (
                    <SelectedAvatar photoURL={lastUserEditing ? lastUserEditing.photoURL : null} />
                ) : lastUserEditing ? (
                    <Image source={{ uri: lastUserEditing.photoURL }} style={localStyles.avatar} />
                ) : (
                    <View style={[localStyles.avatar, { overflow: 'hidden' }]}>
                        <SVGGenericUser width={32} height={32} svgid={`ci_p_observed_list_${lastEditorId}`} />
                    </View>
                )}
                <View style={localStyles.textContainer}>
                    <Text style={localStyles.versionText}>{versionText}</Text>
                    <Text style={localStyles.editionText}>{editionText}</Text>
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 8,
    },
    selectedBackground: {
        borderRadius: 4,
        backgroundColor: hexColorToRGBa('#8A94A6', 0.16),
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
