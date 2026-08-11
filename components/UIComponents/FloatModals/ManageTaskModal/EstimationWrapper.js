import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import EstimationModal from '../EstimationModal/EstimationModal'
import Button from '../../../UIControls/Button'
import { getTaskAutoEstimation, OPEN_STEP } from '../../../TaskListView/Utils/TasksHelper'
import { execShortcutFn } from '../../ShortcutCheatSheet/HelperFunctions'
import { getEstimationIconByValue } from '../../../../utils/EstimationHelper'

export default function EstimationWrapper({ task, projectId, setEstimation, setAutoEstimation }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const cleanedName = task.extendedName.trim()

    return (
        <Popover
            content={
                <EstimationModal
                    projectId={projectId}
                    estimation={task.estimations[OPEN_STEP]}
                    setEstimationFn={setEstimation}
                    closePopover={closeModal}
                    autoEstimation={getTaskAutoEstimation(projectId, task.estimations[OPEN_STEP], task.autoEstimation)}
                    setAutoEstimation={setAutoEstimation}
                    showAutoEstimation={!task.isSubtask}
                    disabled={!!task.calendarData}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+e'}
                onKeyDown={(sht, event) => execShortcutFn(this.estimationBtnRef, openModal, event)}
                filter={e => true}
                disabled={!cleanedName}
            >
                <Button
                    ref={ref => (this.estimationBtnRef = ref)}
                    icon={`count-circle-${getEstimationIconByValue(projectId, task.estimations[OPEN_STEP])}`}
                    iconColor={colors.Text04}
                    buttonStyle={{ backgroundColor: 'transparent', marginRight: 4 }}
                    onPress={openModal}
                    shortcutText={'E'}
                    forceShowShortcut={true}
                    disabled={!cleanedName}
                />
            </Hotkeys>
        </Popover>
    )
}
