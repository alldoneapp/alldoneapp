import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Text, TextInput } from 'react-native'
import v4 from 'uuid/v4'

import URLsAdminPanel, { URL_ADMIN_PANEL_SKILLS } from '../../../URLSystem/AdminPanel/URLsAdminPanel'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import Button from '../../UIControls/Button'
import { unwatch } from '../../../utils/backends/firestore'
import {
    watchGlobalAssistantSkills,
    watchPendingSkillImports,
} from '../../../utils/backends/AssistantSkills/assistantSkillsFirestore'
import AssistantSkillItem from './AssistantSkillItem'
import EditAssistantSkill from './EditAssistantSkill'
import ImportSkillsPanel from './ImportSkillsPanel'

export default function AssistantSkills() {
    const [skills, setSkills] = useState([])
    const [pendingImports, setPendingImports] = useState([])
    const [filter, setFilter] = useState('')
    const [editingSkillId, setEditingSkillId] = useState(null)
    const [showImportPanel, setShowImportPanel] = useState(false)

    useEffect(() => {
        URLsAdminPanel.push(URL_ADMIN_PANEL_SKILLS)
    }, [])

    useEffect(() => {
        const watcherKey = v4()
        watchGlobalAssistantSkills(watcherKey, setSkills)
        return () => {
            unwatch(watcherKey)
        }
    }, [])

    useEffect(() => {
        const watcherKey = v4()
        watchPendingSkillImports(watcherKey, setPendingImports)
        return () => {
            unwatch(watcherKey)
        }
    }, [])

    const filteredSkills = filter
        ? skills.filter(
              skill =>
                  skill.displayName?.toUpperCase().includes(filter.toUpperCase()) ||
                  skill.name?.toUpperCase().includes(filter.toUpperCase())
          )
        : skills

    const skillsAmountText =
        filteredSkills.length === 0
            ? translate('No skills yet')
            : filteredSkills.length === 1
            ? `1 ${translate('Skill')}`
            : `${filteredSkills.length} ${translate('Skills')}`

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('AI Skills')}</Text>
                <View style={localStyles.headerCaption}>
                    <Text style={[styles.caption2, { color: colors.Text02 }]}>{skillsAmountText}</Text>
                </View>
            </View>
            <Text style={[styles.body2, { color: colors.Text02 }]}>{translate('Skills admin description')}</Text>
            <View style={localStyles.toolbar}>
                <TextInput
                    value={filter}
                    onChangeText={setFilter}
                    style={localStyles.filterInput}
                    numberOfLines={1}
                    multiline={false}
                    placeholder={translate('Filter by name')}
                />
                <Button
                    type={'ghost'}
                    icon={'plus-square'}
                    title={translate('Add skill')}
                    onPress={() => setEditingSkillId('new')}
                    buttonStyle={localStyles.toolbarButton}
                />
                <Button
                    type={'ghost'}
                    icon={'download'}
                    title={`${translate('Import from repository')}${
                        pendingImports.length > 0 ? ` (${pendingImports.length})` : ''
                    }`}
                    onPress={() => setShowImportPanel(visible => !visible)}
                    buttonStyle={localStyles.toolbarButton}
                />
            </View>
            {showImportPanel && <ImportSkillsPanel skills={skills} pendingImports={pendingImports} />}
            {editingSkillId === 'new' && <EditAssistantSkill adding={true} onClose={() => setEditingSkillId(null)} />}
            {filteredSkills.map(skill =>
                editingSkillId === skill.uid ? (
                    <EditAssistantSkill
                        key={skill.uid}
                        adding={false}
                        skill={skill}
                        onClose={() => setEditingSkillId(null)}
                    />
                ) : (
                    <AssistantSkillItem key={skill.uid} skill={skill} onPress={() => setEditingSkillId(skill.uid)} />
                )
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        marginBottom: 48,
    },
    header: {
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
    headerCaption: {
        marginLeft: 16,
        height: 22,
        justifyContent: 'center',
    },
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 18,
        marginBottom: 10,
        flexWrap: 'wrap',
    },
    filterInput: {
        minWidth: 150,
        width: 357,
        height: 35,
        ...styles.body1,
        fontWeight: 400,
        color: colors.Text01,
        borderWidth: 1,
        borderRadius: 4,
        borderColor: colors.Gray400,
        paddingHorizontal: 16,
        marginRight: 10,
    },
    toolbarButton: {
        marginRight: 8,
    },
})
