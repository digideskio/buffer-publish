import React from 'react';
import PropTypes from 'prop-types';
import ReactTooltip from 'react-tooltip';
import DragMe from '@bufferapp/dragme';
import AppStore from '../stores/AppStore';
import ComposerStore from '../stores/ComposerStore';
import NotificationStore from '../stores/NotificationStore';
import { AppEnvironments, NotificationScopes, Services, ErrorTypes, SaveButtonTypes }
  from '../AppConstants';
import AppActionCreators from '../action-creators/AppActionCreators';
import AppInitActionCreators from '../action-creators/AppInitActionCreators';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import WebSocket from '../utils/WebSocket';
import ComposerSection from '../components/ComposerSection';
import UpdateSaver from '../components/UpdateSaver';
import ProfileSection from '../components/ProfileSection';
import CloseButton from '../components/CloseButton';
import NotificationContainer from '../components/NotificationContainer';
import PowerSchedulerButton from '../components/PowerSchedulerButton';
import Modals from '../components/Modals';
import { observeStore } from '../utils/StoreUtils';
import AppHooks from '../utils/lifecycle-hooks';

// App-level styles
// import '../../../../../node_modules/normalize.css/normalize.css';
import styles from './css/App.css';

function getState() {
  const scheduledAt = ComposerStore.getScheduledAt();

  return {
    profiles: AppStore.getProfiles(),
    appState: AppStore.getAppState(),
    metaData: AppStore.getMetaData(),
    userData: AppStore.getUserData(),
    scheduledAt,
    availableSchedulesSlotsForDay: AppStore.getAvailableSchedulesSlotsForDay(scheduledAt),
    isPinnedToSlot: ComposerStore.isPinnedToSlot(),
    visibleNotifications: NotificationStore.getVisibleNotifications(),
  };
}

class App extends React.Component {
  static propTypes = {
    profilesData: PropTypes.arrayOf(PropTypes.shape({
      id: PropTypes.string.isRequired,
      serviceName: PropTypes.string.isRequired,
      serviceUsername: PropTypes.string.isRequired,
      serviceFormattedUsername: PropTypes.string.isRequired,
      imagesAvatar: PropTypes.string.isRequired,
      timezone: PropTypes.string.isRequired,
      shouldBeAutoSelected: PropTypes.bool.isRequired,
      isDisabled: PropTypes.bool.isRequired,
      serviceType: PropTypes.string.isRequired,
      isBusinessProfile: PropTypes.bool.isRequired,
      subprofiles: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        profileId: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired,
        avatar: PropTypes.string.isRequired,
        isShared: PropTypes.bool.isRequired,
        shouldBeAutoSelected: PropTypes.bool.isRequired,
      })).isRequired,
    })).isRequired,

    userData: PropTypes.shape({
      id: PropTypes.string.isRequired,
      s3UploadSignature: PropTypes.shape({
        algorithm: PropTypes.string.isRequired,
        base64Policy: PropTypes.string.isRequired,
        bucket: PropTypes.string.isRequired,
        credentials: PropTypes.string.isRequired,
        date: PropTypes.string.isRequired,
        expires: PropTypes.string.isRequired,
        signature: PropTypes.string.isRequired,
        successActionStatus: PropTypes.string.isRequired,
      }).isRequired,
      uses24hTime: PropTypes.bool.isRequired,
      weekStartsMonday: PropTypes.bool.isRequired,
      isFreeUser: PropTypes.bool.isRequired,
      isBusinessUser: PropTypes.bool.isRequired,
      shouldAlwaysSkipEmptyTextAlert: PropTypes.bool.isRequired,
      profileGroups: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired,
        profileIds: PropTypes.arrayOf(PropTypes.string.isRequired).isRequired,
      })).isRequired,
      profilesSchedulesSlots: PropTypes.objectOf(
        PropTypes.objectOf(
          PropTypes.arrayOf(PropTypes.shape({
            isSlotFree: PropTypes.bool.isRequired,
            timestamp: PropTypes.number.isRequired,
          }))
        )
      ),
    }).isRequired,

    metaData: PropTypes.shape({
      environment: PropTypes.string.isRequired,
      appEnvironment: PropTypes.string.isRequired,
      shouldDisplayHelpButton: PropTypes.bool.isRequired,
      shouldEnableFacebookAutocomplete: PropTypes.bool.isRequired,
      shouldUseNewTwitterAutocomplete: PropTypes.bool.isRequired,
      showTwitterImageDescription: PropTypes.bool.isRequired,
      shouldShowRolloutTooltip: PropTypes.bool.isRequired,
      updateId: PropTypes.string,
      scheduledAt: PropTypes.number,
      isPinnedToSlot: PropTypes.bool,
      didUserSetScheduledAt: PropTypes.bool,
      text: PropTypes.string,
      url: PropTypes.string,
      sourceUrl: PropTypes.string,
      via: PropTypes.string,
      images: PropTypes.arrayOf(PropTypes.string),
      video: PropTypes.shape({
        id: React.PropTypes.string.isRequired,
        name: PropTypes.string.isRequired,
        duration: PropTypes.number.isRequired,
        durationMs: PropTypes.number.isRequired,
        size: PropTypes.number.isRequired,
        width: PropTypes.number.isRequired,
        height: PropTypes.number.isRequired,
        url: PropTypes.string.isRequired,
        originalUrl: PropTypes.string.isRequired,
        thumbnail: PropTypes.string.isRequired,
        availableThumbnails: PropTypes.arrayOf(PropTypes.string).isRequired,
      }),
      browser: PropTypes.string,
      extensionVersion: PropTypes.string,
      retweetData: PropTypes.shape({
        text: PropTypes.string.isRequired,
        tweetId: PropTypes.string.isRequired,
        userId: PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]).isRequired,
        userName: PropTypes.string.isRequired,
        userDisplayName: PropTypes.string.isRequired,
        tweetUrl: PropTypes.string.isRequired,
        avatarUrl: PropTypes.string.isRequired,
        comment: PropTypes.string.isRequired,
      }),
      facebookMentionEntities: PropTypes.arrayOf(PropTypes.shape({
        indices: PropTypes.arrayOf(PropTypes.number).isRequired,
        id: PropTypes.number.isRequired,
        name: PropTypes.string.isRequired,
        url: PropTypes.string.isRequired,
      })),
    }).isRequired,

    csrfToken: PropTypes.string.isRequired,
    imageDimensionsKey: PropTypes.string.isRequired,
    onNewPublish: PropTypes.bool,

    options: PropTypes.shape({
      canSelectProfiles: PropTypes.bool.isRequired,
      preserveStateOnClose: PropTypes.bool.isRequired,
      saveButtons: PropTypes.arrayOf(
        PropTypes.oneOf(Object.keys(SaveButtonTypes))
      ).isRequired,
      updateId: PropTypes.string,
      position: PropTypes.shape({
        top: PropTypes.number.isRequired,
        left: PropTypes.number,
      }),
      onSave: PropTypes.func,
    }).isRequired,
  };

  static defaultProps = {
    userData: {
      profileSchedulesSlots: undefined,
      onNewPublish: false,
    },
    options: {
      onSave: () => {},
    },
  };

  constructor(props) {
    super(props);

    this.state = getState();
    this.isInitialized = false; // Ensure we load initial data and open web socket only once
  }

  componentWillMount() {
    AppStore.addChangeListener(this.onStoreChange);
    NotificationStore.addChangeListener(this.onStoreChange);
    /* prevent drop/dragover behavior when dropping a file not in the dropzone*/
    window.addEventListener('drop', (e) => e.preventDefault());
    window.addEventListener('dragover', (e) => e.preventDefault());

    if (!this.isInitialized) this.init();

    AppActionCreators.trackUserAction(['viewed'], {
      timeToRender: (new Date() - window.pageStartTime),
    });
  }

  componentDidMount() {
    observeStore(AppStore, (store) => store.getAppState().isLoaded)
      .then(() => {
        if (this.state.metaData.appEnvironment === AppEnvironments.EXTENSION) {
          this.dragMe = new DragMe(document.querySelector('.js-enable-dragging'), {
            cancel: '.js-disable-dragging',
            onDragStart: (target) => {
              AppActionCreators.trackUserAction(['composer', 'dragged'], {
                draggingTarget: (target === this.draggingAnchor) ? 'dragging-anchor' : 'app-window',
              });
            },
          });
        }
      });
  }

  componentDidUpdate() {
    setTimeout(() => {
      ReactTooltip.rebuild();
    }, 100);
  }

  componentWillUnmount() {
    AppStore.removeChangeListener(this.onStoreChange);
    NotificationStore.removeChangeListener(this.onStoreChange);
    window.removeEventListener('drop', (e) => e.preventDefault());
    window.removeEventListener('dragover', (e) => e.preventDefault());

    if (this.dragMe) this.dragMe.cleanup();

    if (!this.props.options.preserveStateOnClose) {
      AppInitActionCreators.resetData();
    }
  }

  onStoreChange = () => this.setState(getState());

  onAppWrapperClick = (e) => {
    const isBackdropClicked = e.target === e.currentTarget;
    if (isBackdropClicked) AppHooks.handleBackdropClicked();
  };

  onAppClick = (e) => {
    const { expandedComposerId } = this.state.appState;
    const isComposerExpanded = expandedComposerId !== null;

    if (!isComposerExpanded || e.defaultPrevented) return;

    // If users mousedown inside the editor, select some text and then mouseup
    // outside the editor, this action will also trigger a click, which would
    // collapse the composer. We double-check a click doesn't follow the action
    // of selecting text before collapsing the composer.
    const isClickFollowingSelection = getSelection().toString().length > 0;
    if (isClickFollowingSelection) return;

    ComposerActionCreators.collapse(expandedComposerId);
  };

  onCloseButtonClick = () => AppActionCreators.closeComposer();

  init = () => {
    const {
      profilesData,
      userData,
      metaData,
      csrfToken,
      imageDimensionsKey,
      options,
      onNewPublish,
    } = this.props;

    const { preserveStateOnClose } = options;
    const { preserveStateOnClose: prevPreserveStateOnClose = false } = AppStore.getOptions();

    /**
     * options.preserveStateOnClose is used to reset the composers' state on close.
     * However, if options.preserveStateOnClose is true in a previous app instance,
     * since stores are singletons, we'll need to reset the composers' state on load
     * if the new instance has `options.preserveStateOnClose === false`
     */
    if (preserveStateOnClose === false && preserveStateOnClose !== prevPreserveStateOnClose) {
      AppInitActionCreators.resetData();
    }

    /**
     * And since we're sometimes preserving state with options.preserveStateOnClose,
     * we don't want to load initial data *again* when state was preserved. Only load
     * initial data again if the previous instance had its stores reset on close, or if
     * this new instance had its stores reset on init.
     */
    const shouldLoadInitialData = (
      prevPreserveStateOnClose !== true ||
      preserveStateOnClose === false
    );

    if (shouldLoadInitialData) {
      AppInitActionCreators.loadInitialData({
        profilesData,
        userData,
        metaData,
        csrfToken,
        imageDimensionsKey,
        options,
        onNewPublish,
      });
    }

    WebSocket.init();

    this.isInitialized = true;
  };

  render() {
    if (!this.state.appState.isLoaded) return null;

    const { availableSchedulesSlotsForDay, metaData, isPinnedToSlot } = this.state;

    const {
      appEnvironment, showTwitterImageDescription, shouldEnableFacebookAutocomplete,
    } = metaData;

    const { canSelectProfiles, saveButtons, position = null } = this.props.options;

    const selectedProfiles = this.state.profiles.filter((profile) => profile.isSelected);
    const firstSelectedProfile = selectedProfiles[0];
    const firstSelectedProfileTimezone =
      firstSelectedProfile ? firstSelectedProfile.timezone : null;
    const isSlotPickingAvailable = selectedProfiles.length === 1;
    const moreThanOneProfileSelected = selectedProfiles.length > 1;
    const shouldShowInlineSubprofileDropdown = !canSelectProfiles && selectedProfiles.length === 1;

    const appDynamicStyle = {};

    if (position !== null) {
      const shouldOverrideVerticalPositioningOnly = typeof position.left === 'undefined';

      if (shouldOverrideVerticalPositioningOnly) {
        appDynamicStyle.margin = '0 auto';
        appDynamicStyle.top = `${position.top}px`;
      } else {
        appDynamicStyle.position = 'absolute';
        appDynamicStyle.margin = 0;
        appDynamicStyle.top = `${position.top}px`;
        appDynamicStyle.left = `${position.left}px`;
      }
    }

    const topLevelNotificationContainerExcludedScopes = [
      NotificationScopes.BOARD_CREATION,
      NotificationScopes.MC_OMNIBOX_EDIT_NOTICE,
      NotificationScopes.UPDATE_SAVING_AGGREGATE,
      NotificationScopes.MC_ROLLOUT_INFO,
      ...Services.map((service) => `${NotificationScopes.UPDATE_SAVING}-${service.name}`),
      ...Services.map((service) => (
        `${NotificationScopes.UPDATE_SAVING}-${ErrorTypes.INLINE}-${service.name}`
      )),
      ...Services.map((service) => (
        `${NotificationScopes.COMPOSER_NOTICE_NOT_PREFILLED}-${service.name}`
      )),
    ];

    const notificationsContainerClassNames = {
      container: styles.floatingNotificationsContainer,
      notification: styles.floatingNotification,
    };

    const appClassName = [
      styles.app,
      'js-enable-dragging',
    ].join(' ');

    const draggingAnchorClassName = [
      'bi bi-drag',
      styles.draggingAnchor,
    ].join(' ');

    const closeButtonClassName = [
      'bi bi-x',
      styles.closeButton,
    ].join(' ');

    const areAllDraftsSaved = ComposerStore.areAllDraftsSaved();
    const isOmniboxEnabled = this.state.appState.isOmniboxEnabled;
    const showPowerSchedulerButton =
      this.state.metaData.appEnvironment === AppEnvironments.EXTENSION;

    return (
      <div
        ref={(elem) => { this.appElement = elem; }}
        className={styles.appWrapper}
        onClick={this.onAppWrapperClick}
      >
        <Modals />

        {showPowerSchedulerButton &&
          <PowerSchedulerButton
            selectedProfiles={selectedProfiles}
            visibleNotifications={this.state.visibleNotifications}
          />}

        <NotificationContainer
          visibleNotifications={this.state.visibleNotifications}
          classNames={notificationsContainerClassNames}
          notScopes={topLevelNotificationContainerExcludedScopes}
          shouldShowCloseIcon
        />

        <div className={appClassName} style={appDynamicStyle} onClick={this.onAppClick}>

          {appEnvironment === AppEnvironments.EXTENSION &&
            <span className={draggingAnchorClassName} ref={(ref) => (this.draggingAnchor = ref)} />}

          {appEnvironment === AppEnvironments.EXTENSION &&
            <CloseButton className={closeButtonClassName} onClick={this.onCloseButtonClick} />}

          {canSelectProfiles &&
            <ProfileSection
              appState={this.state.appState}
              profiles={this.state.profiles}
              userData={this.state.userData}
              visibleNotifications={this.state.visibleNotifications}
            />}

          <ComposerSection
            isOmniboxEnabled={isOmniboxEnabled}
            appState={this.state.appState}
            profiles={this.state.profiles}
            shouldShowInlineSubprofileDropdown={shouldShowInlineSubprofileDropdown}
            visibleNotifications={this.state.visibleNotifications}
            areAllDraftsSaved={areAllDraftsSaved}
            selectedProfiles={selectedProfiles}
            shouldEnableFacebookAutocomplete={shouldEnableFacebookAutocomplete}
            showTwitterImageDescription={showTwitterImageDescription}
            composerPosition={position}
          />

          <UpdateSaver
            appState={this.state.appState}
            metaData={this.state.metaData}
            userData={this.state.userData}
            timezone={firstSelectedProfileTimezone}
            saveButtons={saveButtons}
            scheduledAt={this.state.scheduledAt}
            isSlotPickingAvailable={isSlotPickingAvailable}
            isPinnedToSlot={isPinnedToSlot}
            availableSchedulesSlotsForDay={availableSchedulesSlotsForDay}
            visibleNotifications={this.state.visibleNotifications}
            moreThanOneProfileSelected={moreThanOneProfileSelected}
            areAllDraftsSaved={areAllDraftsSaved}
            whatPreventsSavingMessages={this.state.appState.whatPreventsSaving}
            isOmniboxEnabled={isOmniboxEnabled}
          />
          <ReactTooltip class={styles.tooltip} effect="solid" place="top" />
        </div>
      </div>
    );
  }
}

export default App;
