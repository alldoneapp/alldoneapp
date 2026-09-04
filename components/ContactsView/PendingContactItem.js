import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Spinner from '../UIComponents/Spinner'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

/**
 * AT-2508 - the row of a contact that has been created locally and is still on its way.
 *
 * It exists because the list cannot show the real thing yet: `watchProjectContacts` filters on
 * the server-written `readerIds` projection, so a contact the user just added matches no query
 * for several seconds (7.35s measured in production - see `optimisticContactCreate.js`). Rather
 * than leave the list unchanged for that whole time, the name the user typed goes on screen
 * immediately, in the row's own shape, saying what is happening to it.
 *
 * Deliberately NOT the real `ContactItem`. That component opens a backlinks watcher and a store
 * subscription per row, renders a `Swipeable` and navigates to a detailed view on press - all
 * against a document that does not exist yet, so the swipe actions would write to nothing and
 * the press would open an empty view. This row is inert on purpose: there is nothing to open,
 * nothing to swipe and nothing to edit until the contact is real, which is a second away.
 *
 * The geometry is `ContactItem.localStyles`', to the pixel, for the same reason
 * `ContactsListSkeleton` copies it: when the real row replaces this one, nothing on the page may
 * move. `ContactItem.js` is the source of truth for these numbers.
 */
export default function PendingContactItem({ contact }) {
    const name = (contact && contact.displayName) || ''

    return (
        <View
            testID="pending-contact-row"
            accessibilityRole="progressbar"
            accessibilityLabel={`${translate('Adding person')}: ${name}`}
            style={localStyles.container}
        >
            <View testID="pending-contact-main-row" style={localStyles.mainRow}>
                <View style={localStyles.avatarContainer}>
                    <Spinner containerSize={48} spinnerSize={24} containerColor={colors.Grey200} />
                </View>

                <View style={localStyles.userData}>
                    <Text style={localStyles.name} numberOfLines={1}>
                        {name}
                    </Text>

                    <Text style={localStyles.status} numberOfLines={1}>
                        {`${translate('Adding person')}...`}
                    </Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    // ContactItem.localStyles.container, minus the swipe/press affordances this row has no use
    // for. The negative horizontal margin plus matching padding is what keeps it aligned with
    // the real rows inside the contacts list's own padding.
    container: {
        paddingTop: 8,
        paddingBottom: 10,
        marginLeft: -8,
        marginRight: -8,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 4,
        flexDirection: 'column',
        overflow: 'hidden',
    },
    mainRow: {
        flexDirection: 'row',
        width: '100%',
        height: 90,
    },
    avatarContainer: {
        justifyContent: 'flex-start',
        overflow: 'hidden',
        width: 48,
        height: 48,
        borderRadius: 100,
    },
    userData: {
        flex: 1,
        minWidth: 0,
        alignSelf: 'flex-start',
        marginLeft: 8,
    },
    name: {
        ...styles.body1,
        color: colors.Text01,
    },
    // Sits on the line `ContactItem` gives the role/company/description, so the row keeps its
    // rhythm while it waits.
    status: {
        ...styles.body2,
        color: colors.Text03,
    },
})
