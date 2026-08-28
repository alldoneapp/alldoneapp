import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Text, TextInput } from 'react-native'
import v4 from 'uuid/v4'

import URLsAdminPanel, { URL_ADMIN_PANEL_SKILLS } from '../../../URLSystem/AdminPanel/URLsAdminPanel'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import Button from '../../UIControls/Button'
import { unwatch } from '../../../utils/backends/firestore'
import {
    watchAssistantSkills,
    watchPendingSkillImports,
} from '../../../utils/backends/AssistantSkills/assistantSkillsFirestore'
import {
    GLOBAL_SKILL_CATALOG_ID as GLOBAL_PROJECT_ID,
    isGlobalSkillCatalog,
} from '../../../utils/AssistantSkills/skillCatalog'
import AssistantSkillItem from './AssistantSkillItem'
import EditAssistantSkill from './EditAssistantSkill'
import ImportSkillsPanel from './ImportSkillsPanel'

/**
 * One skill catalog, rendered for whichever project owns it (AT-2450).
 *
 * `projectId === 'globalProject'` is the administrator's curated catalog inside
 * the Admin Panel — its behaviour here is unchanged. Any other id is a
 * project's own catalog, rendered from the project's settings by
 * `ProjectSkillsProperty`, and every write it makes is authorized by project
 * membership rather than by the administrator role.
 */
export default function AssistantSkills({ projectId = GLOBAL_PROJECT_ID, disabled = false }) {
    const isGlobalCatalog = isGlobalSkillCatalog(projectId)
    const [skills, setSkills] = useState([])
    const [pendingImports, setPendingImports] = useState([])
    const [filter, setFilter] = useState('')
    const [editingSkillId, setEditingSkillId] = useState(null)
    const [showImportPanel, setShowImportPanel] = useState(false)

    useEffect(() => {
        // Only the Admin Panel owns a route; the project catalog is a panel
        // inside project settings and must not rewrite the URL under it.
        if (isGlobalCatalog) URLsAdminPanel.push(URL_ADMIN_PANEL_SKILLS)
    }, [isGlobalCatalog])

    useEffect(() => {
        const watcherKey = v4()
        watchAssistantSkills(projectId, watcherKey, catalogSkills => {
            setSkills(catalogSkills.filter(skill => skill.source?.type !== 'builtin'))
        })
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId])

    useEffect(() => {
        const watcherKey = v4()
        watchPendingSkillImports(watcherKey, setPendingImports, projectId)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId])

    // `disabled` means the viewer cannot write to this catalog (a guide reader, or
    // a project they have no edit access to). Gate ENTERING the editor rather than
    // only the Add button: the security rule would reject the write anyway, but a
    // form that accepts input and then fails on Save is a worse way to find out.
    const openEditor = skillId => {
        if (!disabled) setEditingSkillId(skillId)
    }

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
            <Text style={[styles.body2, { color: colors.Text02 }]}>
                {translate(isGlobalCatalog ? 'Skills admin description' : 'Project skills description')}
            </Text>
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
                    onPress={() => openEditor('new')}
                    buttonStyle={localStyles.toolbarButton}
                    disabled={disabled}
                />
                <Button
                    type={'ghost'}
                    icon={'download'}
                    title={`${translate('Import from repository')}${
                        pendingImports.length > 0 ? ` (${pendingImports.length})` : ''
                    }`}
                    onPress={() => setShowImportPanel(visible => !visible)}
                    buttonStyle={localStyles.toolbarButton}
                    disabled={disabled}
                />
            </View>
            {showImportPanel && (
                <ImportSkillsPanel skills={skills} pendingImports={pendingImports} projectId={projectId} />
            )}
            {editingSkillId === 'new' && (
                <EditAssistantSkill adding={true} projectId={projectId} onClose={() => setEditingSkillId(null)} />
            )}
            {filteredSkills.map(skill =>
                editingSkillId === skill.uid ? (
                    <EditAssistantSkill
                        key={skill.uid}
                        adding={false}
                        skill={skill}
                        projectId={projectId}
                        onClose={() => setEditingSkillId(null)}
                    />
                ) : (
                    <AssistantSkillItem key={skill.uid} skill={skill} onPress={() => openEditor(skill.uid)} />
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
