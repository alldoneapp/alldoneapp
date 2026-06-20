import React from 'react'
import { useSelector } from 'react-redux'

import LoadingScreen from '../LoadingScreen'
import LoginScreenContent from './LoginScreenContent'

export default function LoginScreen() {
    const addingUserToGuide = useSelector(state => state.addingUserToGuide)
    const loggedIn = useSelector(state => state.loggedIn)
    const registeredNewUser = useSelector(state => state.registeredNewUser)
    // While an anonymous visitor's shared-resource link is being resolved in the boot path, show a
    // neutral loading screen instead of the login UI. This keeps LoginScreenContent unmounted, so it
    // never pushes /login into the address bar — we forward straight to the resource view.
    const resolvingSharedResource = useSelector(state => state.resolvingSharedResource)

    return loggedIn || resolvingSharedResource ? (
        <LoadingScreen
            text={addingUserToGuide ? 'Preparing your community project...' : loggedIn ? 'Loading your info...' : ''}
            secondText={registeredNewUser || addingUserToGuide ? 'Please wait - this can take a while' : ''}
        />
    ) : (
        <LoginScreenContent />
    )
}
