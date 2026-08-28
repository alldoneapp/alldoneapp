import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { popoverToSafePosition } from '../../../../utils/HelperFunctions'
import { unwatch } from '../../../../utils/backends/firestore'
import { watchAssistantSkills } from '../../../../utils/backends/AssistantSkills/assistantSkillsFirestore'
import ProjectSkillsModal from './ProjectSkillsModal'

/**
 * Skills this project owns (AT-2450).
 *
 * Until now the only way to add a skill was the Admin Panel, so a single
 * administrator was a bottleneck for every user's assistants. A project skill is
 * added by any member of the project and is available to that project's
 * assistants immediately — there is no per-assistant enablement to flip, because
 * the project IS the sharing boundary. The administrator's curated global
 * catalog is unaffected and still administrator-only.
 */
export default function ProjectSkillsProperty({ project, disabled }) {
    const dispatch = useDispatch()
    const projectId = project.id
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const [skillsAmount, setSkillsAmount] = useState(0)
    const isOpenRef = useRef(false)

    useEffect(() => {
        const watcherKey = v4()
        watchAssistantSkills(projectId, watcherKey, skills => setSkillsAmount(skills.length))
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId])

    const openModal = () => {
        if (isOpenRef.current) return
        isOpenRef.current = true
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (!isOpenRef.current) return
        isOpenRef.current = false
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    useEffect(() => {
        return () => {
            if (isOpenRef.current) {
                isOpenRef.current = false
                dispatch(hideFloatPopup())
            }
        }
    }, [dispatch])

    return (
        <AppPopover
            content={<ProjectSkillsModal projectId={projectId} disabled={disabled} closeModal={closeModal} />}
            onClickOutside={closeModal}
            isOpen={isOpen}
            position={['right', 'bottom', 'left', 'top']}
            padding={4}
            windowBorderPadding={16}
            align={'end'}
            disableReposition={true}
            contentLocation={args => popoverToSafePosition(args, smallScreenNavigation)}
            containerStyle={{
                maxWidth: 'calc(100vw - 32px)',
                maxHeight: 'calc(100vh - 32px)',
                overflow: 'visible',
                zIndex: '9999',
            }}
        >
            <View style={localStyles.propertyRow}>
                <View style={{ justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <Icon name={'zap'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('AI Skills')}</Text>
                </View>
                <View style={{ justifyContent: 'flex-end' }}>
                    <Button
                        icon={'zap'}
                        title={skillsAmount > 0 ? `${translate('Manage')} (${skillsAmount})` : translate('Manage')}
                        type={'ghost'}
                        onPress={openModal}
                    />
                </View>
            </View>
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
})
