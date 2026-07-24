import React, { useState } from 'react'
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import moment from 'moment'

import ModalHeader from '../ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Button from '../../../UIControls/Button'
import Line from '../GoalMilestoneModal/Line'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { getDateFormat, getTimeFormat } from '../DateFormatPickerModal'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import HelperFunctions from '../../../../utils/HelperFunctions'

const CURRENT_PROMPT_ID = 'current'

function getHistoryPrompt(entry, promptField) {
    if (!entry) return ''
    if (typeof entry[promptField] === 'string') return entry[promptField]
    if (typeof entry.prompt === 'string') return entry.prompt
    if (promptField === 'instructions' && typeof entry.instructions === 'string') return entry.instructions
    if (promptField === 'heartbeatPrompt' && typeof entry.heartbeatPrompt === 'string') return entry.heartbeatPrompt
    return ''
}

function PromptVersionItem({ item, isSelected, onSelect }) {
    const date = item.date ? moment(item.date) : null
    const dateText = date ? date.tz('Europe/Berlin').format(getDateFormat()) : ''
    const timeText = date ? date.format(getTimeFormat()) : ''
    const metaText = item.isCurrent
        ? translate('Current version')
        : item.editorName
        ? translate(`Name was last editor • Date Time`, { name: item.editorName, date: dateText, time: timeText })
        : translate(`Version from Date`, { date: dateText })

    return (
        <View style={localStyles.itemContainer}>
            <TouchableOpacity style={[localStyles.item, isSelected && localStyles.selectedItem]} onPress={onSelect}>
                <View style={localStyles.textContainer}>
                    <Text style={localStyles.itemTitle} numberOfLines={1}>
                        {item.title}
                    </Text>
                    <Text style={localStyles.itemMeta} numberOfLines={1}>
                        {metaText}
                    </Text>
                    <Text style={localStyles.preview} numberOfLines={2}>
                        {item.prompt || translate('Empty prompt')}
                    </Text>
                </View>
            </TouchableOpacity>
        </View>
    )
}

export default function AssistantPromptHistoryModal({
    projectId,
    promptField,
    history,
    currentPrompt,
    title,
    description,
    closeModal,
    restorePrompt,
}) {
    const { width: windowWidth } = Dimensions.get('window')
    const isMobile = windowWidth < 600
    const modalWidth = isMobile ? windowWidth - 32 : Math.min(windowWidth * 0.9, 720)
    const [selectedId, setSelectedId] = useState(CURRENT_PROMPT_ID)

    const historyItems = (Array.isArray(history) ? history : []).map((entry, index) => {
        const editorId = entry.replacedByUserId || entry.lastEditorId || ''
        const editor = editorId ? TasksHelper.getUserInProject(projectId, editorId) : null
        const editorName = editor ? HelperFunctions.getFirstName(editor.displayName) : ''
        const date = entry.replacedAt || entry.versionDate || entry.createdAt || 0

        return {
            id: `${index}-${date}`,
            title: date
                ? translate(`Version from Date`, { date: moment(date).tz('Europe/Berlin').format(getDateFormat()) })
                : translate('Previous version'),
            prompt: getHistoryPrompt(entry, promptField),
            date,
            editorName,
            isCurrent: false,
        }
    })

    const items = [
        {
            id: CURRENT_PROMPT_ID,
            title: translate('Current version'),
            prompt: currentPrompt,
            date: 0,
            editorName: '',
            isCurrent: true,
        },
        ...historyItems,
    ]

    const selectedItem = items.find(item => item.id === selectedId) || items[0]
    const canRestore = selectedItem && !selectedItem.isCurrent && selectedItem.prompt !== currentPrompt

    const restoreSelectedPrompt = () => {
        if (!canRestore) return
        restorePrompt(selectedItem.prompt)
        closeModal()
    }

    return (
        <View style={[localStyles.container, { width: modalWidth }, isMobile && localStyles.mobileContainer]}>
            <ModalHeader title={title} description={description} closeModal={closeModal} />
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                {items.map(item => (
                    <PromptVersionItem
                        key={item.id}
                        item={item}
                        isSelected={selectedId === item.id}
                        onSelect={() => setSelectedId(item.id)}
                    />
                ))}
            </CustomScrollView>
            <Line />
            <View style={localStyles.button}>
                <Button
                    icon={'rotate-ccw'}
                    iconColor={'#ffffff'}
                    type={'primary'}
                    onPress={restoreSelectedPrompt}
                    title={translate('Recover')}
                    disabled={!canRestore}
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
        paddingHorizontal: 16,
        height: 548,
    },
    mobileContainer: {
        paddingHorizontal: 8,
    },
    scroll: {
        height: 392,
        marginTop: 8,
    },
    itemContainer: {
        paddingHorizontal: 8,
    },
    item: {
        minHeight: 76,
        paddingHorizontal: 8,
        paddingVertical: 8,
        justifyContent: 'center',
    },
    selectedItem: {
        borderRadius: 4,
        backgroundColor: hexColorToRGBa('#8A94A6', 0.16),
    },
    textContainer: {
        flexDirection: 'column',
    },
    itemTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    itemMeta: {
        ...styles.caption2,
        color: colors.Text03,
    },
    preview: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 4,
    },
    button: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
