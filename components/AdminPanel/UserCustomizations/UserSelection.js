import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View, Text, TextInput } from 'react-native'
import { useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import Button from '../../UIControls/Button'
import { unwatch } from '../../../utils/backends/firestore'
import { resetLoadingData, startLoadingData, stopLoadingData } from '../../../redux/actions'
import { watchUserByEmail } from '../../../utils/backends/Users/usersFirestore'

const INITIAL_STATE = 'INITIAL_STATE'
const SEARCHING_STATE = 'SEARCHING_STATE'
const EMPTY_STATE = 'EMPTY_STATE'
const LOADED_STATE = 'LOADED_STATE'

export default function UserSelection({ setUser, setText }) {
    const dispatch = useDispatch()
    const [userState, setUserState] = useState(INITIAL_STATE)
    const [emailInInput, setEmailInInput] = useState('')
    const [email, setEmail] = useState('')
    const inputText = useRef()

    const onKeyPress = e => {
        if (e.nativeEvent.key === 'Enter') {
            if (emailInInput.trim() && userState !== SEARCHING_STATE) loadUser()
            setTimeout(() => {
                inputText.current.focus()
            })
        }
    }

    const loadUser = async () => {
        if (email.trim() !== emailInInput.trim()) {
            setUser(null)
            dispatch(startLoadingData())
            setUserState(SEARCHING_STATE)
            setEmail(emailInInput.trim())
        }
    }

    const updateUser = user => {
        dispatch(stopLoadingData())
        setUserState(user ? LOADED_STATE : EMPTY_STATE)
        setUser(user)
    }

    useEffect(() => {
        if (userState !== INITIAL_STATE) {
            const watcherKey = v4()
            watchUserByEmail(email, watcherKey, updateUser)
            return () => {
                unwatch(watcherKey)
            }
        }
    }, [email])

    useEffect(() => {
        setText(
            userState === INITIAL_STATE
                ? 'Please search for a user to display his/her data'
                : userState === SEARCHING_STATE
                ? 'Searching user'
                : userState === EMPTY_STATE
                ? 'Sorry, there are no users with that email'
                : ''
        )
    }, [userState])

    useEffect(() => {
        inputText.current.focus()
        return () => {
            dispatch(resetLoadingData())
        }
    }, [])

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.text}>{translate('Search user via email')}</Text>
            <View style={localStyles.inputContainer}>
                <TextInput
                    ref={inputText}
                    value={emailInInput}
                    onChangeText={setEmailInInput}
                    style={localStyles.textInput}
                    numberOfLines={1}
                    multiline={false}
                    placeholder={translate('Add user email')}
                    autoFocus={true}
                    onKeyPress={onKeyPress}
                />
                <Button
                    title={translate('Load user')}
                    type="primary"
                    onPress={loadUser}
                    disabled={!emailInInput.trim() || userState === SEARCHING_STATE}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 32,
        marginBottom: 75,
    },
    text: {
        ...styles.title6,
        color: colors.Text01,
    },
    inputContainer: {
        flexDirection: 'row',
        marginTop: 10,
        alignItems: 'center',
    },
    textInput: {
        minWidth: 150,
        width: 357,
        height: 35,
        ...styles.body1,
        fontWeight: 400,
        color: colors.Text01,
        borderWidth: 1,
        borderRadius: 4,
        borderColor: colors.Gray400,
        paddingHorizontal: 16,
        marginRight: 10,
    },
})
