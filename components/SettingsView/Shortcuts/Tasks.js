import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import CheatShortcutItem from '../../UIComponents/ShortcutCheatSheet/CheatShortcutItem'
import SectionInfo from '../../UIComponents/ShortcutCheatSheet/SectionInfo'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

export default function Tasks() {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    return (
        <View style={localStyles.section}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Tasks')}</Text>
            </View>

            <View style={{ flex: 1 }}>
                <CheatShortcutItem
                    shortcuts={[{ win: 'Alt + Shift + D', mac: '/= + Shift + D' }]}
                    description={translate('Checks the first task checkbox from the open task list')}
                    style={{ marginTop: 0 }}
                />
                <CheatShortcutItem
                    shortcuts={[{ win: 'Alt + G', mac: '/= + G' }]}
                    description={translate('Toggles among Open, Workflow and Done')}
                />
                <CheatShortcutItem
                    shortcuts={[
                        { win: 'Alt + |-', mac: '/= + |-' },
                        { win: 'Alt + ^|', mac: '/= + ^|' },
                    ]}
                    description={translate(
                        'Selects below/above task with edit mode active when there is a task selected on edit mode previously'
                    )}
                />
            </View>

            <SectionInfo text={translate('The following shortcuts are available only when the task is on edit mode')} />

            <View style={{ flexDirection: isMiddleScreen ? 'column' : 'row' }}>
                <View style={{ flex: 1, marginRight: isMiddleScreen ? 0 : 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + S', mac: '/= + S' }]}
                        description={translate('Adds subtask')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + R', mac: '/= + R' }]}
                        description={translate('Opens the pop-up to set reminder')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + E', mac: '/= + E' }]}
                        description={translate('Opens estimation pop-up')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + Del', mac: '/= + Del' }]}
                        description={translate('Deletes the task')}
                    />
                </View>
                <View style={{ flex: 1 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + X', mac: '/= + X' }]}
                        description={translate('Rejects a task from Workflow pop-up')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + A', mac: '/= + A' }]}
                        description={translate('Opens assignee selector')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + J', mac: '/= + J' }]}
                        description={translate('Creates a follow-up task from a task in done section')}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        marginBottom: 24,
    },
    header: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
})
