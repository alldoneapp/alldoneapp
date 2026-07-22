import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer from 'react-test-renderer'

import WorkflowStep from './WorkflowStep'

jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('react-redux', () => ({ useSelector: selector => selector({ isMiddleScreen: false }) }))
jest.mock('../Tags/UserTag', () => () => null)
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({ getDateFormat: () => 'DD.MM.YYYY' }))
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationData: () => ({ displayName: 'User', shortName: 'User', photoURL: null }),
}))

describe('workflow step order controls', () => {
    test('moves the step without opening its editor', () => {
        const onMoveUp = jest.fn()
        const onMoveDown = jest.fn()
        const stopPropagation = jest.fn()
        const tree = renderer.create(
            <WorkflowStep
                stepNumber={2}
                step={{ description: 'Review', date: 0 }}
                canMoveUp
                canMoveDown
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
            />
        )
        const buttons = tree.root.findAllByType(TouchableOpacity)

        buttons[0].props.onPress({ stopPropagation })
        buttons[1].props.onPress({ stopPropagation })

        expect(stopPropagation).toHaveBeenCalledTimes(2)
        expect(onMoveUp).toHaveBeenCalledTimes(1)
        expect(onMoveDown).toHaveBeenCalledTimes(1)
    })
})
