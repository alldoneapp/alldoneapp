import React from 'react'
import { useSelector } from 'react-redux'

import LoadingScreen from '../LoadingScreen'
import LoginScreenContent from './LoginScreenContent'

export default function LoginScreen() {
    const addingUserToGuide = useSelector(state => state.addingUserToGuide)
    const loggedIn = useSelector(state => state.loggedIn)
    const registeredNewUser = useSelector(state => state.registeredNewUser)

    return loggedIn ? (
        <LoadingScreen
            text={addingUserToGuide ? 'Preparing your community project...' : 'Loading your info...'}
            secondText={registeredNewUser || addingUserToGuide ? 'Please wait - this can take a while' : ''}
        />
    ) : (
        <LoginScreenContent />
    )
}
