import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'

import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { rebuildProjectVmGolden } from '../../../../utils/backends/firestore'

// Per-project "golden" VM environment: a pre-baked E2B snapshot (repo + node_modules) that
// cold VM tasks seed from so they skip the dependency install. It refreshes itself when the
// lockfile drifts; this row surfaces its status and offers a manual rebuild. Only shown when a
// repository is connected — the golden bakes that repo's dependencies.
export default function VmGoldenProperty({ project, disabled }) {
    const projectId = project.id
    const repoConnected = !!((project.githubRepoUrl || '').trim() || (project.gitlabRepoUrl || '').trim())
    const golden = project.vmGolden || null
    const [busy, setBusy] = useState(false)

    if (!repoConnected) return null

    const building = busy || (golden && golden.rebuildState === 'building')
    const ready = !!(golden && golden.status === 'ready' && golden.snapshotId)
    const failed = !!(golden && golden.status === 'failed')

    let statusText
    if (building) statusText = translate('VM environment building')
    else if (ready)
        statusText = golden.builtAt
            ? translate('VM environment ready built', { time: moment(golden.builtAt).fromNow() })
            : translate('VM environment ready')
    else if (failed) statusText = translate('VM environment build failed')
    else statusText = translate('VM environment not built')

    const onRebuild = async () => {
        if (busy || (golden && golden.rebuildState === 'building')) return
        setBusy(true)
        try {
            await rebuildProjectVmGolden({ projectId })
        } catch (_) {
            // Errors surface via the golden status on the project doc; keep the button usable.
        } finally {
            setBusy(false)
        }
    }

    return (
        <View style={localStyles.propertyRow}>
            <View style={{ justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Icon name={'cpu'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <View style={{ flex: 1 }}>
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('VM environment')}</Text>
                    <Text style={[styles.body3, { color: colors.Text03 }]} numberOfLines={1}>
                        {statusText}
                    </Text>
                </View>
            </View>
            <View style={{ justifyContent: 'flex-end' }}>
                <Button
                    icon={'refresh-cw'}
                    title={translate(building ? 'Building' : 'Rebuild')}
                    type={'ghost'}
                    onPress={onRebuild}
                    disabled={disabled || building}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    propertyRow: {
        minHeight: 56,
        paddingVertical: 8,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
})
