import React, { useRef } from 'react'
import { StyleSheet } from 'react-native'

import NavigationService from '../../../utils/NavigationService'
import Button from '../../UIControls/Button'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import { goToFeedSource } from '../Utils/HelperFunctions'
import { useDispatch } from 'react-redux'
import { startLoadingData } from '../../../redux/actions'
import { translate } from '../../../i18n/TranslationService'

export default function FeedSourceButton({
    projectId,
    sourceId,
    feedObjectType,
    smallScreen,
    text,
    feedObject,
    disabled,
    actionBeforeSave,
}) {
    const dispatch = useDispatch()
    const openBtnRef = useRef()
    const goToSourceView = () => {
        if (actionBeforeSave) {
            dispatch(startLoadingData())
            actionBeforeSave()
        } else {
            goToFeedSource(NavigationService, projectId, feedObjectType, sourceId)
        }
    }

    return (
        <Hotkeys
            keyName={'alt+O'}
            onKeyDown={(sht, event) => execShortcutFn(openBtnRef.current, goToSourceView, event)}
            filter={e => true}
            disabled={disabled}
        >
            <Button
                ref={openBtnRef}
                title={smallScreen ? null : translate(text)}
                type={'secondary'}
                noBorder={smallScreen}
                icon={'maximize-2'}
                buttonStyle={[localStyles.button, smallScreen && localStyles.buttonSmall]}
                onPress={goToSourceView}
                shortcutText={'O'}
                disabled={disabled}
            />
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    button: {
        marginRight: 32,
    },
    buttonSmall: {
        marginRight: 8,
    },
})
