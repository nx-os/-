/*
Copyright 2020, 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, { createRef } from "react";
import { Room } from "matrix-js-sdk/src/models/room";
import classNames from "classnames";
import * as fbEmitter from "fbemitter";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import defaultDispatcher from "../../dispatcher/dispatcher";
import dis from "../../dispatcher/dispatcher";
import { ActionPayload } from "../../dispatcher/payloads";
import { Action } from "../../dispatcher/actions";
import { _t } from "../../languageHandler";
import { ContextMenuButton } from "./ContextMenu";
import { UserTab } from "../views/dialogs/UserSettingsDialog";
import { OpenToTabPayload } from "../../dispatcher/payloads/OpenToTabPayload";
import FeedbackDialog from "../views/dialogs/FeedbackDialog";
import Modal from "../../Modal";
import LogoutDialog from "../views/dialogs/LogoutDialog";
import SettingsStore from "../../settings/SettingsStore";
import { getCustomTheme } from "../../theme";
import AccessibleButton, { ButtonEvent } from "../views/elements/AccessibleButton";
import SdkConfig from "../../SdkConfig";
import { getHomePageUrl } from "../../utils/pages";
import { OwnProfileStore } from "../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import BaseAvatar from '../views/avatars/BaseAvatar';
import AccessibleTooltipButton from "../views/elements/AccessibleTooltipButton";
import { SettingLevel } from "../../settings/SettingLevel";
import IconizedContextMenu, {
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../views/context_menus/IconizedContextMenu";
import { CommunityPrototypeStore } from "../../stores/CommunityPrototypeStore";
import GroupFilterOrderStore from "../../stores/GroupFilterOrderStore";
import { showCommunityInviteDialog } from "../../RoomInvite";
import { RightPanelPhases } from "../../stores/RightPanelStorePhases";
import ErrorDialog from "../views/dialogs/ErrorDialog";
import EditCommunityPrototypeDialog from "../views/dialogs/EditCommunityPrototypeDialog";
import { UIFeature } from "../../settings/UIFeature";
import HostSignupAction from "./HostSignupAction";
import { IHostSignupConfig } from "../views/dialogs/HostSignupDialogTypes";
import SpaceStore, { UPDATE_SELECTED_SPACE } from "../../stores/SpaceStore";
import RoomName from "../views/elements/RoomName";
import { replaceableComponent } from "../../utils/replaceableComponent";
import InlineSpinner from "../views/elements/InlineSpinner";
import TooltipButton from "../views/elements/TooltipButton";
import { logger } from "matrix-js-sdk/src/logger";
import SpacePanel from "../views/spaces/SpacePanel";
import { SpaceButton, SpaceItem } from "../views/spaces/SpaceTreeLevel";
import * as Avatar from '../../Avatar';

interface IProps {
    isMinimized: boolean;
}

type PartialDOMRect = Pick<DOMRect, "width" | "left" | "top" | "height">;

interface IState {
    contextMenuPosition: PartialDOMRect;
    isDarkTheme: boolean;
    selectedSpace?: Room;
    pendingRoomJoin: Set<string>;
}

@replaceableComponent("structures.SpaceMenu")
export default class SpaceMenu extends React.Component<IProps, IState> {
    private dispatcherRef: string;
    private themeWatcherRef: string;
    private dndWatcherRef: string;
    private buttonRef: React.RefObject<HTMLButtonElement> = createRef();
    private tagStoreRef: fbEmitter.EventSubscription;

    constructor(props: IProps) {
        super(props);

        this.state = {
            contextMenuPosition: null,
            isDarkTheme: this.isUserOnDarkTheme(),
            pendingRoomJoin: new Set<string>(),
        };

        OwnProfileStore.instance.on(UPDATE_EVENT, this.onProfileUpdate);
        if (SpaceStore.spacesEnabled) {
            SpaceStore.instance.on(UPDATE_SELECTED_SPACE, this.onSelectedSpaceUpdate);
        }

        // Force update is the easiest way to trigger the UI update (we don't store state for this)
        this.dndWatcherRef = SettingsStore.watchSetting("doNotDisturb", null, () => this.forceUpdate());
    }

    private get hasHomePage(): boolean {
        return !!getHomePageUrl(SdkConfig.get());
    }

    public componentDidMount() {
        this.dispatcherRef = defaultDispatcher.register(this.onAction);
        this.themeWatcherRef = SettingsStore.watchSetting("theme", null, this.onThemeChanged);
        this.tagStoreRef = GroupFilterOrderStore.addListener(this.onTagStoreUpdate);
        MatrixClientPeg.get().on("Room", this.onRoom);
    }

    public componentWillUnmount() {
        if (this.themeWatcherRef) SettingsStore.unwatchSetting(this.themeWatcherRef);
        if (this.dndWatcherRef) SettingsStore.unwatchSetting(this.dndWatcherRef);
        if (this.dispatcherRef) defaultDispatcher.unregister(this.dispatcherRef);
        OwnProfileStore.instance.off(UPDATE_EVENT, this.onProfileUpdate);
        this.tagStoreRef.remove();
        if (SpaceStore.spacesEnabled) {
            SpaceStore.instance.off(UPDATE_SELECTED_SPACE, this.onSelectedSpaceUpdate);
        }
        MatrixClientPeg.get().removeListener("Room", this.onRoom);
    }

    private onRoom = (room: Room): void => {
        this.removePendingJoinRoom(room.roomId);
    };

    private onTagStoreUpdate = () => {
        this.forceUpdate(); // we don't have anything useful in state to update
    };

    private isUserOnDarkTheme(): boolean {
        if (SettingsStore.getValue("use_system_theme")) {
            return window.matchMedia("(prefers-color-scheme: dark)").matches;
        } else {
            const theme = SettingsStore.getValue("theme");
            if (theme.startsWith("custom-")) {
                return getCustomTheme(theme.substring("custom-".length)).is_dark;
            }
            return theme === "dark";
        }
    }

    private onProfileUpdate = async () => {
        // the store triggered an update, so force a layout update. We don't
        // have any state to store here for that to magically happen.
        this.forceUpdate();
    };

    private onSelectedSpaceUpdate = async (selectedSpace?: Room) => {
        this.setState({ selectedSpace });
    };

    private onThemeChanged = () => {
        this.setState({ isDarkTheme: this.isUserOnDarkTheme() });
    };

    private onAction = (ev: ActionPayload) => {
        switch (ev.action) {
            case Action.ToggleUserMenu:
                if (this.state.contextMenuPosition) {
                    this.setState({ contextMenuPosition: null });
                } else {
                    if (this.buttonRef.current) this.buttonRef.current.click();
                }
                break;
            case Action.JoinRoom:
                this.addPendingJoinRoom(ev.roomId);
                break;
            case Action.JoinRoomReady:
            case Action.JoinRoomError:
                this.removePendingJoinRoom(ev.roomId);
                break;
        }
    };

    private addPendingJoinRoom(roomId: string): void {
        this.setState({
            pendingRoomJoin: new Set<string>(this.state.pendingRoomJoin)
                .add(roomId),
        });
    }

    private removePendingJoinRoom(roomId: string): void {
        if (this.state.pendingRoomJoin.delete(roomId)) {
            this.setState({
                pendingRoomJoin: new Set<string>(this.state.pendingRoomJoin),
            });
        }
    }

    private onOpenMenuClick = (ev: React.MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const target = ev.target as HTMLButtonElement;
        this.setState({ contextMenuPosition: target.getBoundingClientRect() });
               this.setState({
            contextMenuPosition: {
                left: target.getBoundingClientRect().left- target.clientWidth-250,
                top: ev.clientY,
                width: 20,
                height: 0,
            },
        });
    };

    private onContextMenu = (ev: React.MouseEvent) => {
        const target = ev.target as HTMLButtonElement;
        console.log("sdfsdfsdfsdfsdfsdfsd");
        ev.preventDefault();
        ev.stopPropagation();
        this.setState({
            contextMenuPosition: {
                left: ev.clientY,
                top: ev.clientY,
                width: 0,
                height: 0,
            },
        });
    };

    private onCloseMenu = () => {
        this.setState({ contextMenuPosition: null });
    };


    private onProvideFeedback = (ev: ButtonEvent) => {
        ev.preventDefault();
        ev.stopPropagation();

        Modal.createTrackedDialog('Feedback Dialog', '', FeedbackDialog);
        this.setState({ contextMenuPosition: null }); // also close the menu
    };



    private onHomeClick = (ev: ButtonEvent) => {
        ev.preventDefault();
        ev.stopPropagation();

        defaultDispatcher.dispatch({ action: 'view_home_page' });
        this.setState({ contextMenuPosition: null }); // also close the menu
    };

    private onCommunitySettingsClick = (ev: ButtonEvent) => {
        ev.preventDefault();
        ev.stopPropagation();

        Modal.createTrackedDialog('Edit Community', '', EditCommunityPrototypeDialog, {
            communityId: CommunityPrototypeStore.instance.getSelectedCommunityId(),
        });
        this.setState({ contextMenuPosition: null }); // also close the menu
    };


    private onCommunityInviteClick = (ev: ButtonEvent) => {
        ev.preventDefault();
        ev.stopPropagation();

        showCommunityInviteDialog(CommunityPrototypeStore.instance.getSelectedCommunityId());
        this.setState({ contextMenuPosition: null }); // also close the menu
    };

    private onDndToggle = (ev) => {
        ev.stopPropagation();
        const current = SettingsStore.getValue("doNotDisturb");
        SettingsStore.setValue("doNotDisturb", null, SettingLevel.DEVICE, !current);
    };

    private renderContextMenu = (): React.ReactNode => {
        if (!this.state.contextMenuPosition) return null;

        const prototypeCommunityName = CommunityPrototypeStore.instance.getSelectedCommunityName();


        const hostSignupConfig: IHostSignupConfig = SdkConfig.get().hostSignup;
        if (MatrixClientPeg.get().isGuest()) {

        } else if (hostSignupConfig) {
            if (hostSignupConfig && hostSignupConfig.url) {
                // If hostSignup.domains is set to a non-empty array, only show
                // dialog if the user is on the domain or a subdomain.
                const hostSignupDomains = hostSignupConfig.domains || [];
                const mxDomain = MatrixClientPeg.get().getDomain();
                const validDomains = hostSignupDomains.filter(d => (d === mxDomain || mxDomain.endsWith(`.${d}`)));
                if (!hostSignupConfig.domains || validDomains.length > 0) {

                }
            }
        }

        let homeButton = null;
        if (this.hasHomePage) {
            homeButton = (
                <IconizedContextMenuOption
                    iconClassName="mx_UserMenu_iconHome"
                    label={_t("Home")}
                    onClick={this.onHomeClick}
                />
            );
        }

        let feedbackButton;
        if (SettingsStore.getValue(UIFeature.Feedback)) {
            feedbackButton = <IconizedContextMenuOption
                iconClassName="mx_UserMenu_iconMessage"
                label={_t("Feedback")}
                onClick={this.onProvideFeedback}
            />;
        }




        if (prototypeCommunityName) {
            const communityId = CommunityPrototypeStore.instance.getSelectedCommunityId();

            let settingsOption;
            let inviteOption;
            if (CommunityPrototypeStore.instance.canInviteTo(communityId)) {
                inviteOption = (
                    <IconizedContextMenuOption
                        iconClassName="mx_UserMenu_iconInvite"
                        label={_t("Invite")}
                        onClick={this.onCommunityInviteClick}
                    />
                );
            }
            if (CommunityPrototypeStore.instance.isAdminOf(communityId)) {
                settingsOption = (
                    <IconizedContextMenuOption
                        iconClassName="mx_UserMenu_iconSettings"
                        label={_t("Settings")}
                        aria-label={_t("Community settings")}
                        onClick={this.onCommunitySettingsClick}
                    />
                );
            }


        }

        const classes = classNames({
            "mx_UserMenu_contextMenu": true,
            "mx_UserMenu_contextMenu_prototype": !!prototypeCommunityName,
        });

        return <IconizedContextMenu
            // numerical adjustments to overlap the context menu by just over the width of the
            // menu icon and make it look connected
            left={this.state.contextMenuPosition.width + this.state.contextMenuPosition.left - 10}
            top={this.state.contextMenuPosition.top + this.state.contextMenuPosition.height + 8}
            onFinished={this.onCloseMenu}
            className={classes}
        >
            <SpacePanel />
        </IconizedContextMenu>;
    };


    private onExplore = () => {
        dis.fire(Action.ViewRoomDirectory);
    };


    public render() {
        const avatarSize = 32; // should match border-radius of the avatar

        const userId = MatrixClientPeg.get().getUserId();
        const displayName = OwnProfileStore.instance.displayName || userId;
        const avatarUrl = OwnProfileStore.instance.getHttpAvatarUrl(avatarSize);
        //   const savatarUrl = SpaceStore.instance.  .activeSpace.getAvatarUrl() getAvatarUrl();// getHttpAvatarUrl(avatarSize);
        const savatarUrl = Avatar.avatarUrlForRoom(
            this.state.selectedSpace, null, null, null,
        )

        const prototypeCommunityName = CommunityPrototypeStore.instance.getSelectedCommunityName();

        let isPrototype = false;
        let menuName = _t("User menu");
        let name = <span className="mx_UserMenu_userName">{"Home"}</span>;
        let exploreButton = <div></div>;

        if (!this.props.isMinimized) {
            exploreButton =
                <span className="mx_UserMenu_userName">
                    <div className="mx_LeftPanel_filterContainer">
                        <AccessibleTooltipButton
                            className={classNames("mx_LeftPanel_exploreButton", {
                                mx_LeftPanel_exploreButton_space: !!this.state.selectedSpace,
                            })}
                            onClick={this.onExplore}
                            title={this.state.selectedSpace
                                ? _t("Explore %(spaceName)s", { spaceName: this.state.selectedSpace.name })
                                : _t("Explore rooms")}
                        />
                    </div>
                </span>
        }
        //   let buttons = (
        //       <span className="mx_UserMenu_headerButtons">
        //           { /* masked image in CSS */}
        //        </span>
        //    );
        //     let dnd;
        if (this.state.selectedSpace) {
            name = (
                <div className="mx_UserMenu_doubleName">
                    <span className="mx_UserMenu_userName">
                        <RoomName room={this.state.selectedSpace}>
                            {(roomName) => <span>{roomName}</span>}
                        </RoomName>
                    </span>

                </div>
            );
        } else if (prototypeCommunityName) {
            name = (
                <div className="mx_UserMenu_doubleName">
                    <span className="mx_UserMenu_userName">{prototypeCommunityName}</span>
                    <span className="mx_UserMenu_subUserName">{displayName}</span>
                </div>
            );
            menuName = _t("Community and user menu");
            isPrototype = true;
        } else if (SettingsStore.getValue("feature_communities_v2_prototypes")) {
            name = (
                <div className="mx_UserMenu_doubleName">
                    <span className="mx_UserMenu_userName">{_t("Home")}</span>
                    <span className="mx_UserMenu_subUserName">{displayName}</span>
                </div>
            );
            isPrototype = true;
        } else if (SettingsStore.getValue("feature_dnd")) {
            const isDnd = SettingsStore.getValue("doNotDisturb");
            /* dnd = <AccessibleButton
                onClick={this.onDndToggle}
                className={classNames({
                    "mx_UserMenu_dnd": true,
                    "mx_UserMenu_dnd_noisy": !isDnd,
                    "mx_UserMenu_dnd_muted": isDnd,
                })}
            />; */
        }
        if (this.props.isMinimized) {
            name = null;
            //      buttons = null;
        }

        const classes = classNames({
            'mx_UserMenu': true,
            'mx_UserMenu_minimized': this.props.isMinimized,
            'mx_UserMenu_prototype': isPrototype,
        });

        //TODO get space avatar down here from SpaceButton
        return (
            <React.Fragment>
                <ContextMenuButton
                    className={classes}
                    onClick={this.onOpenMenuClick}
                    inputRef={this.buttonRef}
                    label={menuName}
                    isExpanded={!!this.state.contextMenuPosition}
                    onContextMenu={this.onContextMenu}
                >
                    <div className="mx_UserMenu_row">
                        {/*    <BaseAvatar
                                {...this.props}
                                className={classNames(classNames, {
                                    mx_RoomAvatar_isSpaceRoom: true,
                                })}
                                name={"roomName"}
                                idName={"yahe"}
                                urls={this.state.urls}
                                onClick={viewAvatarOnClick && this.state.urls[0] ? this.onRoomAvatarClick : onClick}
                            /> */}
                        {/* 
                        <span className="mx_UserMenu_userAvatarContainer">
                            <SpaceButton
                                space={this.state.selectedSpace}
                                className="mx_UserMenu_userAvatar"
                                // selected={activeSpaces.includes(this.state.selectedSpace)}
                                //  label={this.state.selectedSpace?.name}
                                label={this.state.selectedSpace?.name ?? "Home"}
                                contextMenuTooltip={_t("Space options")}
                                //   notificationState={this.state.selectedSpace.State}
                                isNarrow={this.props.isMinimized}
                                avatarSize={32}
                                onClick={null}
                            //  onKeyDown={this.onKeyDown}
                            //   ContextMenuComponent={this.state.selectedSpace.getMyMembership() === "join" ? SpaceContextMenu : undefined}
                            >
                            </SpaceButton>
                        </span> */}

                        <span className="mx_UserMenu_userAvatarContainer">
                            <BaseAvatar
                                idName={userId}
                                name={this.state.selectedSpace?.name ?? "Home"}
                                // url={avatarUrl}
                                url={savatarUrl}
                                width={avatarSize}
                                height={avatarSize}
                                resizeMethod="crop"
                                className="mx_UserMenu_userAvatar"
                            />
                        </span>
                        {name}
                        {exploreButton}

                    </div>
                </ContextMenuButton>
                {this.state.pendingRoomJoin.size > 0 && (
                    <InlineSpinner>
                        <TooltipButton helpText={_t(
                            "Currently joining %(count)s rooms",
                            { count: this.state.pendingRoomJoin.size },
                        )} />
                    </InlineSpinner>
                )}
                {/*     {dnd} */}
                {/*       {buttons} */}
                {this.renderContextMenu()}
            </React.Fragment>
        );
    }
}
