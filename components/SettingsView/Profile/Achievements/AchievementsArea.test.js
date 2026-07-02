import React from 'react'
import renderer from 'react-test-renderer'
import moment from 'moment'

import AchievementsArea from './AchievementsArea'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, values = {}) => (values.date ? `${key} ${values.date}` : key),
}))

describe('AchievementsArea', () => {
    it('renders empty inbox achievement metrics and activity', () => {
        const tree = renderer.create(
            <AchievementsArea
                user={{
                    emptyInboxDays: [
                        moment().subtract(2, 'days').format('YYYY-MM-DD'),
                        moment().subtract(1, 'day').format('YYYY-MM-DD'),
                    ],
                }}
            />
        )
        const textValues = tree.root.findAllByType('Text').map(item => item.props.children)

        expect(textValues).toContain('Achievements')
        expect(textValues).toContain('Empty inbox')
        expect(textValues).toContain('Current streak')
        expect(textValues).toContain('Longest streak')
        expect(textValues).toContain('Total days')
        expect(textValues).toContain(2)
    })
})
