import React from 'react'
import FollowUpDueDate from '../../components/FollowUp/FollowUpDueDate'
import renderer from 'react-test-renderer'

describe('FollowUpDueDate component', () => {
    describe('FollowUpDueDate snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <FollowUpDueDate
                        closePopover={() => {}}
                        selectDate={true}
                        onCustomDatePress={() => {}}
                        dateText="Today"
                    />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <FollowUpDueDate
                        closePopover={() => {}}
                        selectDate={false}
                        onCustomDatePress={() => {}}
                        dateText="Today"
                    />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
