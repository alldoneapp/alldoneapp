import React from 'react'

import StaticProperty from './StaticProperty'
import { translate } from '../../../i18n/TranslationService'

export default function PostponedAndFollowedCounters({ task }) {
    return (
        <>
            <StaticProperty icon={'coffee'} name={translate('Times postponed')} value={task.timesPostponed} />
            <StaticProperty icon={'calendar-up'} name={translate('Times followed up')} value={task.timesFollowed} />
        </>
    )
}
