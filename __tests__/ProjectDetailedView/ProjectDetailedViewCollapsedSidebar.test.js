/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'

import ProjectDetailedView from '../../components/ProjectDetailedView/ProjectDetailedView'
import BackButton from '../../components/ProjectDetailedView/Header/BackButton'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../../components/styles/global'
import store from '../../redux/store'
import { seedLoggedUser, seedProjects, seedProjectUsers } from '../../testUtils/seedStore'

jest.mock('../../components/SidebarMenu/CustomSideMenu', () => 'CustomSideMenu')
jest.mock('../../hooks/useResetDetailedViewScroll', () => jest.fn())

const navigation = {
    getParam: param => (param === 'projectIndex' ? 0 : {}),
}

describe('ProjectDetailedView collapsed sidebar layout', () => {
    it('offsets the desktop back button with the content panel', () => {
        store.dispatch([
            ...seedProjects([{ name: 'My Project', userIds: ['seeded-user'], guideProjectIds: [] }]),
            ...seedProjectUsers([[{}]]),
            seedLoggedUser({
                isAnonymous: false,
                projectIds: ['seeded-project-0'],
                realProjectIds: ['seeded-project-0'],
                sidebarExpanded: false,
            }),
        ])

        const component = renderer.create(
            <Provider store={store}>
                <ProjectDetailedView navigation={navigation} />
            </Provider>
        )
        const backButtonContainer = component.root.findByType(BackButton).parent

        expect(backButtonContainer.props.style).toMatchObject({ marginLeft: `${SIDEBAR_MENU_COLLAPSED_WIDTH}px` })
    })
})
