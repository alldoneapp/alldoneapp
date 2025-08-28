import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import NavigationService from '../../utils/NavigationService'
import Icon from '../Icon'
import URLTrigger from '../../URLSystem/URLTrigger'
import { useSelector } from 'react-redux'
import {
    getDvMainTabLink,
    getDvNoteTabLink,
    getDvTabLink,
    handleNestedLinks,
    LINKED_OBJECT_TYPE_ASSISTANT,
    LINKED_OBJECT_TYPE_GOAL,
    LINKED_OBJECT_TYPE_NOTE,
    LINKED_OBJECT_TYPE_SKILL,
    LINKED_OBJECT_TYPE_TASK,
} from '../../utils/LinkingHelper'
import { translate } from '../../i18n/TranslationService'
import { cleanTextMetaData, shrinkTagText } from '../../functions/Utils/parseTextUtils'

export default function BacklinksTag({
    object,
    objectType,
    backlinksCount,
    projectId,
    disabled,
    isMobile,
    style,
    backlinkObject,
    outline = false,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const textLimit = outline ? 7 : mobile ? 15 : tablet ? 20 : 25

    const onPress = () => {
        let url = ''

        if (backlinksCount === 1 && backlinkObject) {
            var isTask = backlinkObject.userIds ? true : false
            if (isTask) {
                url = getDvMainTabLink(projectId, backlinkObject.id, 'tasks')
            } else {
                // isNote
                if (backlinkObject.parentObject) {
                    const { type, id } = backlinkObject.parentObject
                    url = getDvNoteTabLink(projectId, id, type)
                } else {
                    url = getDvNoteTabLink(projectId, backlinkObject.id, 'notes')
                }
            }
        } else {
            url = getDvTabLink(projectId, object.id || object.uid, `${objectType}s`, 'backlinks/notes')
        }
        URLTrigger.directProcessUrl(NavigationService, url)
    }

    const getShrinkTagText = (title, textLimit) => {
        const tagText = handleNestedLinks(title)
        return shrinkTagText(tagText, textLimit)
    }

    const isTask = !!(backlinkObject && backlinkObject.userIds)
    return (
        <TouchableOpacity onPress={onPress} disabled={disabled} style={style}>
            <View style={(outline ? otl : localStyles).container}>
                <Icon
                    name={'back-link'}
                    size={outline ? 14 : 16}
                    color={outline ? colors.UtilityBlue200 : colors.Text03}
                    style={(outline ? otl : localStyles).icon}
                />

                {backlinksCount === 1 &&
                    (isTask ? (
                        <Icon
                            name={'check-square'}
                            size={outline ? 14 : 16}
                            color={outline ? colors.UtilityBlue200 : colors.Text03}
                            style={(outline ? otl : localStyles).secondIcon}
                        />
                    ) : (
                        <Icon
                            name={'file-text'}
                            size={outline ? 14 : 16}
                            color={outline ? colors.UtilityBlue200 : colors.Text03}
                            style={(outline ? otl : localStyles).secondIcon}
                        />
                    ))}

                <Text style={[(outline ? otl : localStyles).text, windowTagStyle()]}>
                    {backlinksCount === 1 && backlinkObject?.[isTask ? 'extendedName' : 'extendedTitle']
                        ? getShrinkTagText(
                              cleanTextMetaData(backlinkObject[isTask ? 'extendedName' : 'extendedTitle']),
                              textLimit
                          )
                        : `${backlinksCount}${
                              outline || smallScreenNavigation || isMobile
                                  ? ''
                                  : backlinksCount <= 1
                                  ? ` ${translate('Backlink')}`
                                  : ` ${translate('Backlinks')}`
                          }`}
                </Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    secondIcon: {
        marginRight: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
    userImage: {
        height: 16,
        width: 16,
        borderRadius: 100,
        marginLeft: 4,
    },
})

const otl = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderRadius: 50,
        borderWidth: 1,
        borderColor: colors.UtilityBlue200,
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
    },
    icon: {
        marginHorizontal: 3,
    },
    secondIcon: {
        marginRight: 3,
    },
    text: {
        ...styles.caption1,
        color: colors.UtilityBlue200,
        marginVertical: 1,
        marginRight: 6,
        marginLeft: 2,
    },
})
