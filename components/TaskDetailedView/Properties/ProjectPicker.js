import React, { useRef, useState } from 'react'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'

import Button from '../../UIControls/Button'
import SelectProjectModal from '../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModal'

import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'

export default function ProjectPicker({
    project,
    item,
    disabled,
    taskProjectMoveHandoff,
    taskProjectMovePending,
    onTaskProjectMoveStarted,
    onTaskProjectMoveEnqueued,
    onTaskProjectMoveEnqueueFailed,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const buttonRef = useRef()
    const name = project?.name ? project.name : translate('Project')
    const color = project?.color ? project.color : '#06EEC1'

    const [showPopup, setShowPopup] = useState(false)
    const [noteMoveTarget, setNoteMoveTarget] = useState(null)
    const noteMovePending = !!noteMoveTarget

    const closePopover = () => {
        setShowPopup(false)
    }

    const openPopover = () => {
        setShowPopup(true)
        buttonRef?.current?.blur()
    }

    return (
        <AppPopover
            content={
                showPopup && (
                    <SelectProjectModal
                        item={item}
                        project={project}
                        closePopover={closePopover}
                        onTaskProjectMoveStarted={onTaskProjectMoveStarted}
                        onTaskProjectMoveEnqueued={onTaskProjectMoveEnqueued}
                        onTaskProjectMoveEnqueueFailed={onTaskProjectMoveEnqueueFailed}
                        onNoteProjectMoveStarted={setNoteMoveTarget}
                        onNoteProjectMoveFinished={() => setNoteMoveTarget(null)}
                    />
                )
            }
            onClickOutside={closePopover}
            isOpen={showPopup}
            position={['left', 'bottom', 'right', 'top']}
            align={'end'}
            padding={4}
            contentLocation={mobile ? null : undefined}
        >
            <Button
                ref={buttonRef}
                type={'ghost'}
                title={shrinkTagText(name)}
                color={color}
                onPress={openPopover}
                buttonStyle={{ maxWidth: 240 }}
                disabled={disabled || noteMovePending}
                processing={taskProjectMovePending || noteMovePending}
                processingTitle={noteMovePending ? shrinkTagText(name) : translate('working_on_it')}
                accessibilityLabel={
                    noteMovePending
                        ? translate('Moving to projectName', { projectName: noteMoveTarget.name || '' })
                        : taskProjectMovePending
                          ? translate('Moving task to projectName', {
                                projectName: taskProjectMoveHandoff?.targetProject?.name || '',
                            })
                          : undefined
                }
            />
        </AppPopover>
    )
}
