import Colors from '../../../Themes/Colors'
import { PROJECT_COLOR_DEFAULT, PROJECT_COLOR_SYSTEM } from '../../../Themes/Modern/ProjectColors'
import { hexColorToRGBa } from '../../styles/global'
import { CREATE_PROJECT_THEME_DEFAULT, INVITE_THEME_DEFAULT } from '../../Feeds/CommentsTextInput/textInputHelper'

const ThemeColors = {
    CustomSideMenu: {
        container: {
            backgroundColor: Colors.Primary400,
        },
        floatingContainer: {
            backgroundColor: Colors.Primary400,
        },
        overlayContainer: {
            backgroundColor: Colors.Primary400,
        },
        backdrop: {
            backgroundColor: Colors.Transparent,
        },
        backdropDesktop: {
            backgroundColor: Colors.Transparent,
        },
        activeSection: {
            borderBottomColor: Colors.Secondary200,
        },
        scroll: {
            opacity: 0.32,
        },
        infoContainer: {
            opacity: 0.4,
        },
        iconInfoColor: Colors.White,

        // AmountBadge component
        AmountBadge: {
            container: _color => ({
                // here we use a unique color
                backgroundColor: Colors.Primary100,
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
            logoColor: Colors.White,
            logoNameColor: Colors.White,
        },

        // AllProjects component
        AllProjects: {
            containerActive: {
                backgroundColor: Colors.Primary300,
            },
            containerInactive: {
                backgroundColor: Colors.Primary400,
            },
            title: {
                color: Colors.White,
            },
            titleInactive: {
                color: Colors.White,
                opacity: 0.8,
            },
            amount: {
                color: Colors.White,
            },
        },

        // ProjectList component
        ProjectList: {
            // ProjectItem component
            ProjectItem: {
                container: _color => ({
                    // here we use a unique color
                    backgroundColor: Colors.Primary400,
                }),
                containerActive: _color => ({
                    // here we use a unique color
                    backgroundColor: Colors.Primary300,
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
                    markerText: _color => {
                        return Colors.White
                    },
                    indicatorText: {
                        color: Colors.White,
                    },
                },

                // ProjectItemName component
                ProjectItemName: {
                    title: {
                        color: Colors.Grey400,
                    },
                    titleActive: {
                        color: Colors.White,
                    },
                },

                // ProjectItemAmount component
                ProjectItemAmount: {
                    amountActive: {
                        color: Colors.White,
                    },
                },

                // ProjectSectionList component
                ProjectSectionList: {
                    ProjectSectionItem: {
                        // styles for Tasks
                        userList: _color => ({
                            borderTopColor: Colors.Primary400,
                            borderBottomColor: Colors.Primary400,
                        }),
                        showMore: _color => ({
                            // here we use a unique color
                            backgroundColor: Colors.Secondary250,
                        }),

                        // SectionItemLayout component
                        SectionItemLayout: {
                            icon: Colors.Grey400,
                            container: _color => ({
                                // here we use a unique color
                                backgroundColor: Colors.Secondary250,
                            }),
                            text: {
                                color: Colors.Grey400,
                            },
                            iconActive: Colors.White,
                            containerActive: _color => ({
                                // here we use a unique color
                                backgroundColor: Colors.Primary200,
                            }),
                            textActive: {
                                color: Colors.White,
                            },
                            containerSelected: _color => ({
                                // here we use a unique color
                                backgroundColor: Colors.Secondary200,
                            }),
                            // UserItem component
                            UserItem: {
                                // here we use a unique color
                                container: _color => ({
                                    backgroundColor: Colors.Secondary250,
                                }),
                                containerActive: _color => ({
                                    backgroundColor: Colors.Primary200,
                                }),
                                selectedIndicator: _color => ({
                                    backgroundColor: Colors.Grey400,
                                }),
                                name: {
                                    color: Colors.Grey400,
                                },
                                nameActive: {
                                    color: Colors.White,
                                },
                                amount: {
                                    color: Colors.Text03,
                                },
                                amountActive: {
                                    color: Colors.White,
                                },
                            },
                        },

                        // InvitePeopleButton component
                        InvitePeopleButton: {
                            // here we use a unique color
                            container: _color => ({
                                backgroundColor: Colors.Secondary250,
                            }),
                            containerActive: _color => ({
                                backgroundColor: Colors.Primary200,
                            }),
                            placeholder: {
                                color: Colors.Grey400,
                            },
                        },
                    },

                    // MediaBar component
                    MediaBar: {
                        bar: _color => ({
                            // here we use a unique color
                            backgroundColor: Colors.Secondary200,
                        }),
                        vLine: {
                            borderLeftColor: Colors.Secondary100,
                        },
                        icon: Colors.Secondary100,
                    },
                },
            },
        },

        // AddProject component
        AddProject: {
            placeholderText: {
                color: Colors.White,
                opacity: 0.4,
            },
            containerHover: {
                backgroundColor: Colors.Primary300,
            },

            // AddProjectForm component
            AddProjectForm: {
                inputTheme: CREATE_PROJECT_THEME_DEFAULT,
                icon: Colors.White,
                container: {
                    borderColor: Colors.Primary350,
                    backgroundColor: Colors.Primary400,
                },
                textInput: {
                    color: Colors.White,
                },
                buttonsContainer: {
                    backgroundColor: Colors.Primary350,
                },
                placeholderText: hexColorToRGBa(Colors.White, 0.4),
                addButton: {
                    backgroundColor: Colors.Secondary200,
                },

                // ColorButton component
                ColorButton: {
                    container: {
                        backgroundColor: Colors.Secondary200,
                        borderColor: Colors.Secondary200,
                    },
                    text: {
                        color: Colors.White,
                    },
                },
            },
        },

        // ArchivedProjects component
        ArchivedProjects: {
            text: {
                color: Colors.White,
                opacity: 0.4,
            },
            textActive: {
                color: Colors.White,
                opacity: 0.8,
            },
            containerHover: {
                backgroundColor: Colors.Primary300,
            },
        },

        // GuideProjects component
        GuideProjects: {
            text: {
                color: Colors.Grey400,
                opacity: 0.6,
            },
        },

        // TemplateProjects component
        TemplateProjects: {
            text: {
                color: Colors.White,
                opacity: 0.4,
            },
            textActive: {
                color: Colors.White,
                opacity: 0.8,
            },
            containerHover: {
                backgroundColor: Colors.Primary300,
            },
        },

        // SharedProjects component
        SharedProjects: {
            text: {
                color: Colors.White,
                opacity: 0.8,
            },
        },

        // Version component
        Version: {
            text: {
                color: Colors.White,
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
                color: Colors.White,
            },
            separator: {
                backgroundColor: Colors.White,
            },
        },

        // HelpItem component
        HelpItem: {
            container: {
                backgroundColor: 'transparent',
            },
            containerActive: {
                backgroundColor: Colors.Primary300,
            },
            text: {
                color: Colors.White,
                opacity: 0.4,
            },
        },

        // Marketplace component
        Marketplace: {
            container: {
                backgroundColor: 'transparent',
            },
            containerActive: {
                backgroundColor: Colors.Primary300,
            },
            text: {
                color: Colors.Grey400,
            },
        },

        // CollapseButton component
        CollapseButton: {
            parent: {
                backgroundColor: Colors.Primary400,
            },
            iconColor: Colors.White,
            text: {
                color: Colors.White,
            },
            container: {
                opacity: 0.4,
            },
        },
    },
    AnonymousSideMenu: {
        AnonymousHeader: {
            logoColor: Colors.White,
            logoNameColor: Colors.White,
        },
        AnonymousSidebarBody: {
            text: {
                color: Colors.White,
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
