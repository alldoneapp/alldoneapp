import React from 'react'
import Hotkeys from 'react-hot-keys'
import GhostButton from '../../UIControls/GhostButton'
import { useSelector } from 'react-redux'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../i18n/TranslationService'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'

export default function ParentGoalButton({ onPress, disabled, activeGoal }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const processText = text => {
        const cleanedText = TasksHelper.getTaskNameWithoutMeta(text)
        const textLimit = 13
        const shrinkedText = shrinkTagText(cleanedText, textLimit)
        return shrinkedText
    }

    const textShrinked = activeGoal ? processText(activeGoal.extendedName) : translate('Add to goal')

    return (
        <Hotkeys keyName={`alt+G`} disabled={disabled || blockShortcuts} onKeyDown={onPress} filter={e => true}>
            <GhostButton
                ref={ref => (this.buttonRef = ref)}
                title={textShrinked}
                type={'ghost'}
                icon={activeGoal ? null : 'target'}
                onPress={onPress}
                disabled={disabled}
                shortcutText="G"
            />
        </Hotkeys>
    )
}
