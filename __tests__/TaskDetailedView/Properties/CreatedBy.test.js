import React from 'react'
import CreatedBy from '../../../components/TaskDetailedView/Properties/CreatedBy'

import renderer from 'react-test-renderer'

describe('CreatedBy component', () => {
    describe('CreatedBy snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <CreatedBy createdDate={541235648} creator={{ photoURL: 'https://', displayName: 'Master Yoda' }} />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
