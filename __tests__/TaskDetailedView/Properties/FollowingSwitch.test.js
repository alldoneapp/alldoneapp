import React from 'react'
import FollowingSwitch from '../../../components/TaskDetailedView/Properties/FollowingSwitch'

import renderer from 'react-test-renderer'

describe('FollowingSwitch component', () => {
    it('should render correctly', () => {
        const tree = renderer.create(<FollowingSwitch />).toJSON()
        expect(tree).toMatchSnapshot()
    })

    it.each([true, false])
        ('should render correctly after call onPress with state "yes" as %p',
            (yesArg) => {
                const tree = renderer.create(<FollowingSwitch />)
                const instance = tree.getInstance()
                instance.state.yes = yesArg

                instance.onPress()
                expect(tree).toMatchSnapshot()
            })
})
