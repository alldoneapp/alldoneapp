import React from 'react'

import StaticProperty from './StaticProperty'
import { translate } from '../../../i18n/TranslationService'

export default function RecurrenceCounters({ task }) {
    return (
        <>
            <StaticProperty
                icon={'thumbs-up-checked'}
                name={translate('Times done in streak')}
                value={task.timesDoneInExpectedDay}
            />
            <StaticProperty icon={'square-checked'} name={translate('Times done')} value={task.timesDone} />
        </>
    )
}
