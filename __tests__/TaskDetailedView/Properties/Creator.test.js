import React from 'react'
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
        it('should return the semantically right string to show the date with', () => {
            const tree = renderer.create(
                <Creator createdDate={541235648} creator={{ photoURL: 'https://', displayName: 'Master Yoda' }} />
            )
            const instance = tree.getInstance()
            expect(instance.parseDate('Today at 16:43')).toEqual('on Today at 16:43')
            expect(instance.parseDate('02/19/2020')).toEqual('on the 02/19/2020')
        })
    })
})
