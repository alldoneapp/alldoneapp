/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import { seedProjectUsers, seedProjects } from '../../../testUtils/seedStore'
import UserProperties from '../../../components/UserDetailedView/UserProperties/UserProperties'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'
import store from '../../../redux/store'
