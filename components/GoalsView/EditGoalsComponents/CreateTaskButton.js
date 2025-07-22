import React from 'react'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import URLTrigger from '../../../URLSystem/URLTrigger'
import NavigationService from '../../../utils/NavigationService'
import { getDvTabLink } from '../../../utils/LinkingHelper'

export default function CreateTaskButton({ updateCurrentChanges, disabled, projectId, goalId }) {
    const smallScreen = useSelector(state => state.smallScreen)

    const goToGoalTasks = () => {
        setTimeout(() => {
            updateCurrentChanges()
            const path = getDvTabLink(projectId, goalId, 'goals', 'tasks/open')
            URLTrigger.processUrl(NavigationService, path)
        })
    }

    return (
        <Hotkeys
            keyName={'alt+T'}
            onKeyDown={(sht, event) => execShortcutFn(this.taskBtnRef, goToGoalTasks, event)}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={ref => (this.taskBtnRef = ref)}
                title={smallScreen ? null : translate('Tasks to Goal')}
                type={'ghost'}
                noBorder={smallScreen}
                icon={'check-square'}
                buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                onPress={goToGoalTasks}
                shortcutText={'T'}
                disabled={disabled}
            />
        </Hotkeys>
    )
}
