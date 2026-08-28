import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import { translate } from '../../../../i18n/TranslationService'
import AssistantSkills from '../../../AdminPanel/AssistantSkills/AssistantSkills'

/**
 * The project's own skill catalog (AT-2450).
 *
 * It renders the SAME `AssistantSkills` panel the Admin Panel does, pointed at
 * this project instead of `globalProject`. Reusing it rather than forking a
 * project-flavoured copy is deliberate: the add/edit form, the bundle upload and
 * the repo import are the parts most likely to grow, and two copies would drift.
 * Everything the panel does is authorized on the server and in firestore.rules by
 * the project id it is given, never by which screen mounted it.
 */
export default function ProjectSkillsModal({ projectId, disabled, closeModal }) {
    const [, windowHeight] = useWindowSize()

    return (
        <View style={localStyles.container}>
            <View
                style={[localStyles.card, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(windowHeight) }]}
            >
                <CustomScrollView showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('AI Skills')}
                        description={translate('Project skills description')}
                    />
                    <AssistantSkills projectId={projectId} disabled={disabled} />
                </CustomScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
    },
    card: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
    },
})
