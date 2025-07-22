import React from 'react'
import CustomFollowUpDateModal from '../../components/FollowUp/CustomFollowUpDateModal'
import renderer from 'react-test-renderer'

describe('CustomFollowUpDateModal component', () => {
    describe('CustomFollowUpDateModal snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <CustomFollowUpDateModal hidePopover={() => {}} selectDate={() => {}} backToDueDate={() => {}} />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
