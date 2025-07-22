import React from 'react'
import { StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../../../../UIControls/Button'
import { colors } from '../../../../styles/global'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'
import AssigneesIcon from '../../../../GoalsView/EditGoalsComponents/AssigneesIcon'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function AssigneesButton({ projectId, showAssignees, assigneesIds, disabled }) {
    const isGuide = !!ProjectHelper.getProjectById(projectId).parentTemplateId

    const buttonCustomIcon =
        assigneesIds.length > 0 ? (
            <AssigneesIcon
                assigneesIds={assigneesIds}
                disableModal={true}
                projectId={projectId}
                workstreamBackgroundColor={'transparent'}
            />
        ) : undefined

    return (
        <Hotkeys
            keyName={'alt+A'}
            onKeyDown={(sht, event) => {
                execShortcutFn(this.assigneesBtnRef, showAssignees, event)
            }}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.assigneesBtnRef = ref)}
                icon={assigneesIds.length === 0 ? 'users' : undefined}
                iconColor={colors.Text04}
                buttonStyle={localStyles.buttonsStyle}
                onPress={showAssignees}
                disabled={disabled || isGuide}
                shortcutText={'A'}
                forceShowShortcut={true}
                customIcon={buttonCustomIcon}
            />
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    buttonsStyle: {
        backgroundColor: colors.Secondary200,
        marginRight: 4,
    },
})
