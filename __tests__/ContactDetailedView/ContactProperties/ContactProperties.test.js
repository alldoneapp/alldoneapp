/**
 * @jest-environment jsdom
 */

import React from 'react'
import ContactProperties from '../../../components/ContactDetailedView/ContactProperties/ContactProperties'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { setProjectsUsers, storeLoggedUserProjects, setProjectsContacts } from '../../../redux/actions'

jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => {
    return {
        __esModule: true,
        default: {
            setContactCompanyInProject: () => { },
            setContactRoleInProject: () => { },
            getUserRoleInProject: () => { },
            getUserCompanyInProject: () => { }
        },
    }
})

jest.mock('../../../utils/BackendBridge', () => {
    return {
        __esModule: true,
        default: {
            setProjectContactPicture: () => { },
            setProjectContactPhone: () => { },
            setProjectContactPrivacy: () => { },
            setProjectContactEmail: () => { }
        },
    }
})

jest.mock('../../../utils/HelperFunctions', () => {
    return {
        __esModule: true,
        default: {
            resizeImage: () => { return { uri: 'URI' } },
            convertURItoBlob: () => { }
        },
    }
})


describe('ContactProperties component', () => {
    beforeEach(() => {
        store.dispatch([
            storeLoggedUserProjects([{ name: 'My Project', userIds: [], usersData: [] }]),
            setProjectsUsers([[{ displayName: 'pepitp' }]]),
            setProjectsContacts({ 0: [{ uid: 'uid1' }] })
        ])
    })

    describe('ContactProperties snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<ContactProperties projectIndex={0} user={{ role: '', photoURL: '' }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    it('should unmount correctly', () => {
        const tree = renderer
            .create(<ContactProperties projectIndex={0} user={{ role: '', photoURL: '' }} />)
        var mockFn = jest.fn()
        tree.getInstance().state.unsubscribe = mockFn
        tree.unmount()
        expect(mockFn).toBeCalledTimes(1)
    })

    it('should showModal correctly', () => {
        const tree = renderer
            .create(<ContactProperties projectIndex={0} user={{ role: '', photoURL: '' }} />)
        const instance = tree.getInstance()
        instance.showModal('modal1')

        expect(instance.state.modal1).toEqual(true)
    })

    it('should hideModal correctly', () => {
        const tree = renderer
            .create(<ContactProperties projectIndex={0} user={{ role: '', photoURL: '' }} />)
        const instance = tree.getInstance()
        instance.hideModal('modal1')

        expect(instance.state.modal1).toEqual(false)
    })

    it('should deleteContact without errors', () => {
        const tree = renderer
            .create(<ContactProperties projectIndex={0} user={{ role: '', photoURL: '' }} />)
        const instance = tree.getInstance()
        instance.deleteContact()
    })

    xit('should changePropertyValue without errors', async () => {
        const tree = renderer
            .create(<ContactProperties projectIndex={0} user={{ uid: 'uid1', role: '', photoURL: '' }} />)
        const instance = tree.getInstance()
        for (const prop of ['company', 'role', 'picture', 'email', 'phone', 'privacy']) {
            await instance.changePropertyValue(prop, 'value')
        }
    })
})
