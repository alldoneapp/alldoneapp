import React from 'react'
import moment from 'moment'
import Creator from '../../../components/TaskDetailedView/Properties/Creator'

import renderer from 'react-test-renderer'

describe('Creator component', () => {
    describe('Creator snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Creator createdDate={541235648} creator={{ photoURL: 'https://', displayName: 'Master Yoda' }} />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Creator methods', () => {
        it('marks a date from today differently to an older one', () => {
            const tree = renderer.create(
                <Creator createdDate={541235648} creator={{ photoURL: 'https://', displayName: 'Master Yoda' }} />
            )
            const instance = tree.getInstance()

            // parseDate takes a moment now and does its own formatting.
            // translate() turns 'on Day' into 'on' and 'on the Day' into 'on the',
            // then the formatted date follows, so the prefix is what distinguishes them.
            expect(instance.parseDate(moment()).startsWith('on the')).toBe(false)
            expect(instance.parseDate(moment().subtract(1, 'year')).startsWith('on the')).toBe(true)
        })
    })
})
