import React, { Component } from 'react'
import { colors } from '../../../styles/global'
import store from '../../../../redux/store'
import { showConfirmPopup } from '../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_TOPIC } from '../../../UIComponents/ConfirmPopup'
import Button from '../../../UIControls/Button'
import { DV_TAB_ROOT_CHATS } from '../../../../utils/TabNavigationConstants'
import { translate } from '../../../../i18n/TranslationService'

export default class DeleteChatButton extends Component {
    constructor(props) {
        super(props)
    }

    render() {
        return (
            <Button
                icon={'trash-2'}
                title={translate('Delete Topic')}
                type={'ghost'}
                iconColor={colors.UtilityRed200}
                titleStyle={{ color: colors.UtilityRed200 }}
                buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2 }}
                onPress={this.onPress}
                accessible={false}
            />
        )
    }

    onPress = () => {
        store.dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_TOPIC,
                object: {
                    chat: this.props.chat,
                    projectId: this.props.projectId,
                    navigation: DV_TAB_ROOT_CHATS,
                },
            })
        )
    }
}
