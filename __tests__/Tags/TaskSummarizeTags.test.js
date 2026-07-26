/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Platform } from 'react-native'
import TaskSummarizeTags from '../../components/Tags/TaskSummarizeTags'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('TaskSummarizeTags component', () => {
    describe('TaskSummarizeTags empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<TaskSummarizeTags amountTags={0} onPress={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
