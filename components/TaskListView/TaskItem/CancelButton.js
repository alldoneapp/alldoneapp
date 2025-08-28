import React from 'react'

import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'

export default function CancelButton({ buttonItemStyle, dismissEditMode }) {
    return (
        <Button
            ref={ref => (this.cancelBtnRef = ref)}
            title={translate('Cancel')}
            type={'secondary'}
            buttonStyle={buttonItemStyle}
            onPress={() => dismissEditMode(false)}
            shortcutText={'Esc'}
        />
    )
}
