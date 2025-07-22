import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import styles, { em2px } from '../../styles/global'
import LogInButton from '../../UIControls/LogInButton'
import ModernImage from '../../../utils/ModernImage'
import { Themes } from '../Themes/index'
import { getTheme } from '../../../Themes/Themes'
import { translate } from '../../../i18n/TranslationService'
import CustomScrollView from '../../UIControls/CustomScrollView'

export default function AnonymousUserSidebarBody() {
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'AnonymousSideMenu.AnonymousSidebarBody')
    const theme2 = getTheme(Themes, themeName, 'CustomSideMenu')

    return (
        <CustomScrollView showsVerticalScrollIndicator={false} indicatorStyle={theme2.scroll}>
            <View style={bodySt.container}>
                <ModernImage
                    srcWebp={require('../../../web/images/illustrations/PersonajeEnseñando.webp')}
                    fallback={require('../../../web/images/illustrations/PersonajeEnseñando.png')}
                    style={{ flex: 1, width: '100%', maxWidth: 262 }}
                    alt={'User showing features'}
                />
                <View style={bodySt.subContainer}>
                    <Text style={[bodySt.text, theme.text]}>{translate('anonymous sidebar body')}</Text>
                    <View style={{ marginTop: 16 }}>
                        <LogInButton
                            contentButton={
                                <View style={[bodySt.signInBtn, theme.signInBtn]}>
                                    <Icon size={24} name={'log-in'} color={'#ffffff'} />
                                    <Text style={[bodySt.signInBtnText, theme.signInBtnText]}>
                                        {translate('Log In')}
                                    </Text>
                                </View>
                            }
                        />
                    </View>
                </View>
            </View>
        </CustomScrollView>
    )
}

const bodySt = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 0,
    },
    subContainer: {
        paddingLeft: 24,
        paddingRight: 19,
        justifyContent: 'center',
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle2,
        marginTop: 32,
        textAlign: 'center',
    },
    signInBtn: {
        width: 108,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 16,
        borderRadius: 4,
    },
    signInBtnText: {
        marginLeft: 12,
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
    },
})
