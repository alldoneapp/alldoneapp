import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { listMenubarAppTokens, revokeMenubarAppToken } from '../../../../utils/backends/firestore'
import { colors } from '../../../styles/global'
import styles from '../../../styles/global'
import { getTimeFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'

export default function ConnectedAppsSection() {
    const [tokens, setTokens] = useState([])
    const [loading, setLoading] = useState(true)
    const [revokingId, setRevokingId] = useState('')

    const loadTokens = async () => {
        try {
            const result = await listMenubarAppTokens()
            setTokens(Array.isArray(result.data) ? result.data : [])
        } catch (error) {
            console.error('ConnectedAppsSection: failed to load tokens', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadTokens()
    }, [])

    const onRevoke = async tokenId => {
        setRevokingId(tokenId)
        try {
            await revokeMenubarAppToken(tokenId)
            setTokens(currentTokens => currentTokens.filter(token => token.id !== tokenId))
        } catch (error) {
            console.error('ConnectedAppsSection: failed to revoke token', error)
        } finally {
            setRevokingId('')
        }
    }

    if (!loading && tokens.length === 0) return null

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.title}>{translate('Connected apps')}</Text>
            <Text style={localStyles.description}>
                {translate('Apps signed in with your Alldone account - revoking signs the app out')}
            </Text>
            {loading ? (
                <Text style={localStyles.meta}>{translate('Loading')}</Text>
            ) : (
                tokens.map((token, index) => (
                    <View key={token.id} style={[localStyles.item, index > 0 && localStyles.itemDivider]}>
                        <View style={localStyles.itemLeft}>
                            <Text style={localStyles.itemTitle}>
                                Anna Alldone{token.tokenSuffix ? ` (…${token.tokenSuffix})` : ''}
                            </Text>
                            <Text style={localStyles.meta}>
                                {translate('Connected')}:{' '}
                                {token.createdAt ? moment(token.createdAt).format(getTimeFormat(true)) : '—'}
                                {'   '}
                                {translate('Last used')}:{' '}
                                {token.lastUsedAt ? moment(token.lastUsedAt).format(getTimeFormat(true)) : '—'}
                            </Text>
                        </View>
                        <Button
                            title={translate('Revoke')}
                            type={'ghost'}
                            onPress={() => onRevoke(token.id)}
                            processing={revokingId === token.id}
                            processingTitle={translate('Loading')}
                        />
                    </View>
                ))
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 32,
    },
    title: {
        ...styles.title6,
        color: colors.Text01,
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
        marginBottom: 8,
    },
    item: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
    },
    itemDivider: {
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
    },
    itemLeft: {
        flex: 1,
        paddingRight: 16,
    },
    itemTitle: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
})
