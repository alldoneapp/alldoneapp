import React from 'react'

import WorkspaceOverlayLayer from '../WorkspaceOverlayLayer'
import EndDayStatisticsModal from './EndDayStatisticsModal'
import { useAnnaLayout } from '../../../utils/annaMode'
import { isNewDayFullWindowLayout } from './newDayPopupScope'

/**
 * The one mount of the "new day" popup (AT-3083). Mounted once in AppContent for every
 * layout, so App, Assistant and Both share the same instance (never two popups in Both,
 * and a layout switch keeps its state). Only the placement changes: the Alldone pane in
 * App mode, the whole window in Assistant and Both (see `newDayPopupScope.js`).
 */
const NewDayPopupHost = () => {
    const fullWindow = isNewDayFullWindowLayout(useAnnaLayout())
    return (
        <WorkspaceOverlayLayer fullWindow={fullWindow}>
            <EndDayStatisticsModal fullWindow={fullWindow} />
        </WorkspaceOverlayLayer>
    )
}

export default NewDayPopupHost
