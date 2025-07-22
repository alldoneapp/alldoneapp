import Colors from '../../../Themes/Colors'
import { PROJECT_COLOR_DEFAULT, PROJECT_COLOR_SYSTEM } from '../../../Themes/Modern/ProjectColors'
import { CREATE_PROJECT_THEME_MODERN, INVITE_THEME_MODERN } from '../../Feeds/CommentsTextInput/textInputHelper'
import { em2px } from '../../styles/global'

const ThemeColors = {
    CustomSideMenu: {
        container: {
            backgroundColor: Colors.GraySidebar,
        },
        floatingContainer: {
            backgroundColor: Colors.GraySidebar,
            shadowColor: 'rgba(4, 20, 47, 0.24)',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 6,
            elevation: 3,
        },
        overlayContainer: {
            backgroundColor: Colors.GraySidebar,
        },
        backdrop: {
            backgroundColor: Colors.Transparent,
        },
        backdropDesktop: {
            backgroundColor: Colors.Transparent,
            shadowColor: 'rgba(4, 20, 47, 0.24)',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 6,
            elevation: 3,
            zIndex: 10,
        },
        activeSection: {
            borderBottomColor: Colors.Marker_PrimaryBlue_03,
        },
        scroll: {
            opacity: 0.12,
        },
        infoContainer: {
            opacity: 0.64,
        },
        iconInfoColor: Colors.Text04,

        // AmountBadge component
        AmountBadge: {
            container: color => ({
                backgroundColor:
                    PROJECT_COLOR_SYSTEM[color]?.MARKER || PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.MARKER,
            }),
            amount: {
                color: Colors.Text03,
            },
            amountActive: {
                color: Colors.Text02,
            },
            amountHighlight: {
                color: Colors.White,
            },
        },

        // Header component
        Header: {
            logoColor: Colors.Primary100,
            logoNameColor: Colors.Primary100,
        },

        // AllProjects component
        AllProjects: {
            containerActive: {
                backgroundColor: Colors.Marker_PrimaryBlue_03,
            },
            containerInactive: {
                backgroundColor: Colors.GraySidebar,
            },
            title: {
                color: Colors.Text02,
            },
            titleInactive: {
                color: Colors.Text03,
            },
            amount: {
                color: Colors.Text03,
            },
        },

        // ProjectList component
        ProjectList: {
            // ProjectItem component
            ProjectItem: {
                container: color => ({
                    backgroundColor:
                        PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM ||
                        PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM,
                }),
                containerActive: color => ({
                    backgroundColor:
                        PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_ACTIVE ||
                        PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_ACTIVE,
                }),

                // ProjectItemIcon component
                ProjectItemIcon: {
                    indicator: {
                        backgroundColor: Colors.UtilityRed200,
                    },
                    marker: color => {
                        return (
                            PROJECT_COLOR_SYSTEM[color]?.MARKER || PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.MARKER
                        )
                    },
                    markerText: color => {
                        return (
                            PROJECT_COLOR_SYSTEM[color]?.MARKER_TEXT ||
                            PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.MARKER_TEXT
                        )
                    },
                    indicatorText: {
                        color: Colors.White,
                    },
                },

                // ProjectItemName component
                ProjectItemName: {
                    title: {
                        color: Colors.Text03,
                    },
                    titleActive: {
                        color: Colors.Text02,
                    },
                },

                // ProjectItemAmount component
                ProjectItemAmount: {
                    amountActive: {
                        color: Colors.Text03,
                    },
                },

                // ProjectSectionList component
                ProjectSectionList: {
                    ProjectSectionItem: {
                        // styles for Tasks
                        userList: color => ({
                            borderTopColor:
                                PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_ACTIVE ||
                                PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_ACTIVE,
                            borderBottomColor:
                                PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_ACTIVE ||
                                PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_ACTIVE,
                        }),
                        showMore: color => ({
                            backgroundColor:
                                PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_ITEM ||
                                PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_ITEM,
                        }),

                        // SectionItemLayout component
                        SectionItemLayout: {
                            icon: Colors.Text02,
                            container: color => ({
                                backgroundColor:
                                    PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION ||
                                    PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION,
                            }),
                            text: {
                                color: Colors.Text02,
                            },
                            iconActive: Colors.Text02,
                            containerActive: color => ({
                                backgroundColor:
                                    PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_ACTIVE ||
                                    PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_ACTIVE,
                            }),
                            textActive: {
                                fontFamily: 'Roboto-Medium',
                                letterSpacing: em2px(0.01),
                                color: Colors.Text02,
                            },
                            containerSelected: color => ({
                                backgroundColor:
                                    PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_SELECTED ||
                                    PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_SELECTED,
                            }),
                            // UserItem component
                            UserItem: {
                                // here we use a unique color
                                container: color => ({
                                    backgroundColor:
                                        PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_ITEM ||
                                        PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_ITEM,
                                }),
                                containerActive: color => ({
                                    backgroundColor:
                                        PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_ITEM_ACTIVE ||
                                        PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_ITEM_ACTIVE,
                                }),
                                selectedIndicator: color => ({
                                    backgroundColor:
                                        PROJECT_COLOR_SYSTEM[color]?.MARKER ||
                                        PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.MARKER,
                                }),
                                name: {
                                    color: Colors.Text02,
                                },
                                nameActive: {
                                    fontFamily: 'Roboto-Medium',
                                    letterSpacing: em2px(0.01),
                                    color: Colors.Text02,
                                },
                                amount: {
                                    color: Colors.Text03,
                                },
                                amountActive: {
                                    color: Colors.Text03,
                                },
                            },
                        },

                        // InvitePeopleButton component
                        InvitePeopleButton: {
                            // here we use a unique color
                            container: color => ({
                                backgroundColor:
                                    PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_ITEM ||
                                    PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_ITEM,
                            }),
                            containerActive: color => ({
                                backgroundColor:
                                    PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_ITEM_ACTIVE ||
                                    PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_ITEM_ACTIVE,
                            }),
                            placeholder: {
                                color: Colors.Text02,
                            },
                        },
                    },

                    // MediaBar component
                    MediaBar: {
                        bar: color => ({
                            backgroundColor:
                                PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_ITEM ||
                                PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_ITEM,
                        }),
                        vLine: {
                            borderLeftColor: Colors.Text03,
                        },
                        icon: Colors.Text03,
                    },
                },
            },
        },

        // AddProject component
        AddProject: {
            placeholderText: {
                color: Colors.Text04,
            },
            containerHover: {
                backgroundColor: Colors.Marker_PrimaryBlue_03,
            },

            // AddProjectForm component
            AddProjectForm: {
                inputTheme: CREATE_PROJECT_THEME_MODERN,
                icon: Colors.Primary100,
                container: {
                    borderColor: Colors.Grey200,
                    backgroundColor: Colors.White,
                },
                textInput: {
                    color: Colors.Primary100,
                },
                buttonsContainer: {
                    backgroundColor: Colors.Grey100,
                },
                placeholderText: Colors.Text04,
                addButton: {
                    backgroundColor: Colors.Primary300,
                },

                // ColorButton component
                ColorButton: {
                    container: {
                        backgroundColor: Colors.Grey100,
                        borderColor: Colors.Grey400,
                    },
                    text: {
                        color: Colors.Text03,
                    },
                },
            },
        },

        // ArchivedProjects component
        ArchivedProjects: {
            text: {
                color: Colors.Text04,
                opacity: 0.64,
            },
            textActive: {
                fontFamily: 'Roboto-Medium',
                letterSpacing: em2px(0.01),
                color: Colors.Text02,
                opacity: 1,
            },
            containerHover: {
                backgroundColor: Colors.Marker_PrimaryBlue_03,
            },
        },

        // GuideProjects component
        GuideProjects: {
            text: {
                color: Colors.Text03,
                opacity: 0.6,
            },
        },

        // TemplateProjects component
        TemplateProjects: {
            text: {
                color: Colors.Text04,
                opacity: 0.64,
            },
            textActive: {
                fontFamily: 'Roboto-Medium',
                letterSpacing: em2px(0.01),
                color: Colors.Text02,
                opacity: 1,
            },
            containerHover: {
                backgroundColor: Colors.Marker_PrimaryBlue_03,
            },
        },

        // SharedProjects component
        SharedProjects: {
            text: {
                fontFamily: 'Roboto-Medium',
                letterSpacing: em2px(0.01),
                color: Colors.Text02,
                opacity: 1,
            },
        },

        // Version component
        Version: {
            text: {
                color: Colors.Text03,
                opacity: 0.4,
            },
            refresh: {
                backgroundColor: Colors.Primary200,
            },
            refreshText: {
                color: Colors.White,
            },
        },

        // ImpressumLink component
        ImpressumLink: {
            text: {
                color: Colors.Text03,
                opacity: 0.4,
            },
            separator: {
                backgroundColor: Colors.Text03,
                opacity: 0.4,
            },
        },

        // HelpItem component
        HelpItem: {
            container: {
                backgroundColor: 'transparent',
            },
            containerActive: {
                backgroundColor: Colors.Marker_PrimaryBlue_03,
            },
            text: {
                color: Colors.Text04,
                opacity: 0.64,
            },
        },

        // Marketplace component
        Marketplace: {
            container: {
                backgroundColor: 'transparent',
            },
            containerActive: {
                backgroundColor: Colors.Marker_PrimaryBlue_03,
            },
            text: {
                color: Colors.Text03,
            },
        },

        // CollapseButton component
        CollapseButton: {
            parent: {
                backgroundColor: Colors.GraySidebar,
            },
            iconColor: Colors.Text03,
            text: {
                color: Colors.Text04,
            },
            container: {
                opacity: 0.64,
            },
        },
    },
    AnonymousSideMenu: {
        AnonymousHeader: {
            logoColor: Colors.Primary100,
            logoNameColor: Colors.Primary100,
        },
        AnonymousSidebarBody: {
            text: {
                color: Colors.Text03,
            },
            signInBtn: {
                backgroundColor: Colors.Secondary300,
            },
            signInBtnText: {
                color: Colors.White,
            },
        },
    },
}

export default ThemeColors
