import React from 'react'

import renderer from 'react-test-renderer'
import ChangeTextFieldModal from '../../components/UIComponents/FloatModals/ChangeTextFieldModal'

describe('ChangeTextFieldModal component', () => {
    describe('ChangeTextFieldModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<ChangeTextFieldModal header={'Testing'} label={'Text'} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
