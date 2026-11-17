import React from 'react'

import Button from '../../../UIControls/Button'
import Spinner from '../../Spinner'

// One element for the module: Button rebuilds its styles whenever `icon` changes identity, so a
// fresh element per render would rebuild them on every keystroke during an upload.
const UPLOAD_SPINNER = (
    <Spinner containerSize={24} spinnerSize={18} containerColor="transparent" spinnerColor="#ffffff" />
)

export default function DoneButton({ done, disabled, uploading = false }) {
    // Enter is handled once, by TaskEditForm's document listener. This button
    // used to register a third identical listener for the same key, which made
    // one Return press run the creation several times.
    return (
        <Button
            // AT-3070: while the draft's files upload, the button itself shows the work in place
            // of its plus, so the disabled state does not read as a dead button.
            icon={uploading ? UPLOAD_SPINNER : 'plus'}
            iconColor={'#ffffff'}
            type={'primary'}
            onPress={done}
            shortcutText={'Enter'}
            forceShowShortcut={true}
            disabled={disabled || uploading}
            accessibilityState={{ disabled: disabled || uploading, busy: uploading }}
        />
    )
}
