import React, { useEffect, useState } from 'react'
import Popover from 'react-tiny-popover'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import URLsSettings, { URL_SETTINGS_SKILLS } from '../../../URLSystem/Settings/URLsSettings'
import { translate } from '../../../i18n/TranslationService'
import { getGlobalAssistantSkills } from '../../../utils/backends/AssistantSkills/assistantSkillsFirestore'
import {
    getSkillPersonalOverlayLabel,
    getSkillRuntimeLabelKey,
    isTaskPrioritizationSkill,
} from '../../AdminPanel/AssistantSkills/assistantSkillsHelper'
import TaskPriorityLearningOverlayModal from '../../UIComponents/FloatModals/TaskPriorityLearningOverlayModal/TaskPriorityLearningOverlayModal'

export default function SettingsSkills() {
    const [skills, setSkills] = useState([])
    const [loading, setLoading] = useState(true)
    const [overlaySkill, setOverlaySkill] = useState(null)

    useEffect(() => {
        URLsSettings.push(URL_SETTINGS_SKILLS)
    }, [])

    useEffect(() => {
        let mounted = true
        getGlobalAssistantSkills()
            .then(catalogSkills => {
                if (mounted) setSkills(catalogSkills.filter(skill => skill.enabled !== false))
            })
            .finally(() => {
                if (mounted) setLoading(false)
            })
        return () => {
            mounted = false
        }
    }, [])

    const closeOverlay = () => {
        setOverlaySkill(null)
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <Icon name="zap" size={24} color={colors.Primary100} style={localStyles.headerIcon} />
                <View style={localStyles.headerText}>
                    <Text style={localStyles.title}>{translate('AI Skills')}</Text>
                    <Text style={localStyles.description}>
                        {translate(
                            'You can use skills for your assistants as defined globally by Alldone. Some skills also support a personal overlay, so your assistants can adapt the skill to your preferences while keeping the global skill definition unchanged.'
                        )}
                    </Text>
                </View>
            </View>

            <View style={localStyles.infoBand}>
                <Text style={localStyles.infoTitle}>{translate('Global skills, personal rules')}</Text>
                <Text style={localStyles.infoText}>
                    {translate(
                        'Global skills define what assistants know how to do. Personal overlays are private rules that only affect your assistants.'
                    )}
                </Text>
            </View>

            <Text style={localStyles.sectionTitle}>{translate('Available skills')}</Text>

            {loading ? (
                <Text style={localStyles.emptyText}>{translate('Loading skills')}</Text>
            ) : skills.length === 0 ? (
                <Text style={localStyles.emptyText}>{translate('No skills in the catalog yet')}</Text>
            ) : (
                skills.map(skill => {
                    const overlayLabel = getSkillPersonalOverlayLabel(skill)
                    const canEditOverlay = isTaskPrioritizationSkill(skill)

                    return (
                        <View key={skill.uid || skill.name} style={localStyles.skillRow}>
                            <View style={localStyles.skillMain}>
                                <View style={localStyles.skillTitleRow}>
                                    <Text style={localStyles.skillTitle}>{skill.displayName || skill.name}</Text>
                                    {!!overlayLabel && (
                                        <View style={localStyles.overlayBadge}>
                                            <Text style={localStyles.overlayBadgeText}>{translate(overlayLabel)}</Text>
                                        </View>
                                    )}
                                </View>
                                <Text style={localStyles.skillDescription}>{skill.description}</Text>
                                <Text style={localStyles.runtimeText}>{translate(getSkillRuntimeLabelKey(skill))}</Text>
                            </View>
                            {canEditOverlay && (
                                <Popover
                                    content={
                                        <TaskPriorityLearningOverlayModal skill={skill} closeModal={closeOverlay} />
                                    }
                                    align="end"
                                    position={['bottom', 'left', 'right', 'top']}
                                    onClickOutside={closeOverlay}
                                    isOpen={overlaySkill?.uid === skill.uid}
                                >
                                    <Button
                                        type="secondary"
                                        icon="settings"
                                        title={translate('Edit learned rules')}
                                        onPress={() => setOverlaySkill(skill)}
                                        disabled={overlaySkill?.uid === skill.uid}
                                    />
                                </Popover>
                            )}
                        </View>
                    )
                })
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        marginTop: 56,
        paddingBottom: 64,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 24,
    },
    headerIcon: {
        marginTop: 4,
        marginRight: 12,
    },
    headerText: {
        flex: 1,
    },
    title: {
        ...styles.title6,
        color: colors.Text01,
        marginBottom: 8,
    },
    description: {
        ...styles.body1,
        color: colors.Text02,
    },
    infoBand: {
        backgroundColor: colors.UtilityBlue100,
        borderRadius: 4,
        padding: 16,
        marginBottom: 24,
    },
    infoTitle: {
        ...styles.subtitle2,
        color: colors.Text01,
        marginBottom: 4,
    },
    infoText: {
        ...styles.body2,
        color: colors.Text02,
    },
    sectionTitle: {
        ...styles.title7,
        color: colors.Text01,
        marginBottom: 12,
    },
    skillRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 4,
        padding: 16,
        marginBottom: 12,
        backgroundColor: '#FFFFFF',
    },
    skillMain: {
        flex: 1,
        paddingRight: 16,
    },
    skillTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: 4,
    },
    skillTitle: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginRight: 8,
    },
    skillDescription: {
        ...styles.body2,
        color: colors.Text02,
        marginBottom: 6,
    },
    runtimeText: {
        ...styles.caption2,
        color: colors.Text03,
    },
    overlayBadge: {
        borderRadius: 4,
        backgroundColor: colors.UtilityGreen100,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    overlayBadgeText: {
        ...styles.caption2,
        color: colors.UtilityGreen300,
    },
    emptyText: {
        ...styles.body2,
        color: colors.Text03,
    },
})
