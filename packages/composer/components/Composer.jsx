/**
 * Component that displays a composer
 */

import React from 'react';
import PropTypes from 'prop-types';
import ReactTooltip from 'react-tooltip';
import ReactDOMServer from 'react-dom/server';
import uniqBy from 'lodash.uniqby';
import AppActionCreators from '../action-creators/AppActionCreators';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import NotificationActionCreators from '../action-creators/NotificationActionCreators';
import Editor from '../components/Editor';
import NotificationContainer from '../components/NotificationContainer';
import CharacterCount from '../components/CharacterCount';
import LinkAttachment from '../components/LinkAttachment';
import MediaAttachment from '../components/MediaAttachment';
import RetweetAttachment from '../components/RetweetAttachment';
import SuggestedMediaBox from '../components/SuggestedMediaBox';
import AttachmentGlance from '../components/AttachmentGlance';
import ComposerProfileTooltip from '../components/ComposerProfileTooltip';
import PinterestComposerBar from '../components/PinterestComposerBar';
import TooltipList from '../components/TooltipList';
import Button from '../components/Button';
import { AttachmentTypes, MediaTypes, NotificationScopes, ErrorTypes, QueueingTypes }
  from '../AppConstants';

import styles from './css/Composer.css';

class Composer extends React.Component {
  static propTypes = {
    appState: PropTypes.object.isRequired,
    draft: PropTypes.object.isRequired,
    enabledDrafts: PropTypes.array.isRequired,
    draftsSharedData: PropTypes.object.isRequired,
    visibleNotifications: PropTypes.array.isRequired,
    areAllDraftsSaved: PropTypes.bool.isRequired,
    shouldEnableFacebookAutocomplete: PropTypes.bool.isRequired,
    shouldShowInlineSubprofileDropdown: PropTypes.bool.isRequired,
    profiles: PropTypes.array,
    expandedComposerId: PropTypes.string,
    selectedProfiles: PropTypes.array,
    children: PropTypes.node,
    showTwitterImageDescription: PropTypes.bool.isRequired,
    composerPosition: PropTypes.object,
  };

  static defaultProps = {
    children: null,
    composerPosition: null,
  };

  state = {
    didRenderOnce: false,
    shouldAutoFocusEditor: false,
  };

  componentWillReceiveProps(nextProps) {
    /**
     * Auto-focus editor upon expanding composer. A composer can be considered
     * as expanding:
     * - When it was previously collapsed, and user expanded it
     * - When the app hasn't loaded, and the composer is auto-expanded on load
     */
    const willBeExpanded = nextProps.expandedComposerId === this.props.draft.id;
    const isExpanded = this.isExpanded() && this.state.didRenderOnce;
    const shouldAutoFocusEditor = !isExpanded && willBeExpanded;
    this.setState({ didRenderOnce: true, shouldAutoFocusEditor });
  }

  onComposerClick = (e) => {
    if (this.isDisplayedBehind()) {
      e.preventDefault();
      this.expand();
    }
  };

  onNetworkIconClick = (e) => {
    e.preventDefault();
    this.toggleExpandedState();
  };

  // Ensure other parts of the app ignore click events coming from inside the composer
  // (e.g. when collapsing an expanded composer when a click is registered outside).
  // Don't prevent default for file input clicks or links, but prevent them from bubbling up,
  // so that the default browser action (file selection) still happens.
  onUpdateZoneClick = (e) => {
    if (!this.isExpanded()) return;

    const isFileInputTargeted =
      e.target.tagName === 'INPUT' && e.target.getAttribute('type') === 'file';
    const isLinkTargeted = e.target.tagName === 'A';

    if (isFileInputTargeted || isLinkTargeted) e.stopPropagation();
    else e.preventDefault();
  };

  onLinkAttachmentSwitchClick = () => {
    AppActionCreators.trackUserAction(['composer', 'attachment', 'enabled'], {
      attachment_type: AttachmentTypes.LINK,
      button_clicked: 'CTA_replace_with_link_attachment',
      attachment_replaced: AttachmentTypes.Media,
    });

    ComposerActionCreators.toggleAttachment(this.props.draft.id, AttachmentTypes.LINK);
  }

  onRetweetAttachmentSwitchClick = () => {
    AppActionCreators.trackUserAction(['composer', 'attachment', 'enabled'], {
      attachment_type: AttachmentTypes.RETWEET,
      button_clicked: 'CTA_replace_with_retweet_attachment',
      attachment_replaced: AttachmentTypes.Media,
    });

    ComposerActionCreators.toggleAttachment(this.props.draft.id, AttachmentTypes.RETWEET);
  }

  onMediaAttachmentSwitchClick = () => {
    const replacedAttachment =
      this.isLinkAttachmentEnabled() && this.hasLinkAttachment() ? AttachmentTypes.LINK :
      this.isRetweetAttachmentEnabled() && this.hasRetweetAttachment() ? AttachmentTypes.RETWEET :
      'no_previous_attachment';

    AppActionCreators.trackUserAction(['composer', 'attachment', 'enabled'], {
      attachment_type: AttachmentTypes.MEDIA,
      button_clicked: 'CTA_replace_with_media_attachment',
      attachment_replaced: replacedAttachment,
    });

    ComposerActionCreators.toggleAttachment(this.props.draft.id, AttachmentTypes.MEDIA);
  };

  onEditorFocus = () => this.expand();

  getSuggestedMedia = (shouldFilterOutAttachedMedia) => {
    const { draft, enabledDrafts, draftsSharedData } = this.props;
    const otherEnabledDrafts = enabledDrafts.filter((enabledDraft) => enabledDraft.id !== draft.id);
    const availableImages = draft.availableImages;
    const availableLinkThumbnails = draft.link !== null && draft.link.availableThumbnails !== null ?
      draft.link.availableThumbnails : [];
    const availableSourceLinkImages = draft.sourceLink !== null ?
      draft.sourceLink.availableImages : [];

    let suggestedMedia = Array.prototype.concat.call(
      // Other enabled drafts' attached videos
      otherEnabledDrafts.reduce((attachedVideos, otherDraft) =>
        (otherDraft.video !== null ? attachedVideos.concat(otherDraft.video) : attachedVideos),
      []),
      // Other enabled drafts' attached images
      ...otherEnabledDrafts.map((otherDraft) => otherDraft.images),
      // Other enabled drafts' attached gifs (if service supports gifs)
      draft.service.canHaveMediaAttachmentType(MediaTypes.GIF) ?
        otherEnabledDrafts.reduce((attachedGifs, otherDraft) =>
          (otherDraft.gif !== null ? attachedGifs.concat(otherDraft.gif) : attachedGifs),
        []) :
        [],
      draftsSharedData.uploadedVideos, // All uploaded videos
      draftsSharedData.uploadedImages, // All uploaded images
      // All uploaded gifs (if service supports gifs)
      draft.service.canHaveMediaAttachmentType(MediaTypes.GIF) ?
        draftsSharedData.uploadedGifs : [],
      availableImages, // This draft's available images
      availableLinkThumbnails, // This draft's link attachment's available thumbnails
      availableSourceLinkImages // Images found on this draft's source url page
    );

    if (shouldFilterOutAttachedMedia) {
      suggestedMedia = suggestedMedia.filter((suggestedItem) => (
        !draft.images.find((image) => suggestedItem.url === image.url) &&
        !(draft.video && draft.video.url === suggestedItem.url) &&
        !(draft.gif && draft.gif.url === suggestedItem.url)
      ));
    }

    // Deduplicate suggested media
    return uniqBy(suggestedMedia, (e) => e.url);
  };

  getAttachmentThumbnails = () => {
    let thumbnails = null;
    const draft = this.props.draft;
    const attachmentType = this.props.draft.enabledAttachmentType;
    if (attachmentType === AttachmentTypes.MEDIA && draft.video !== null) {
      thumbnails = [draft.video.thumbnail];
    } else if (attachmentType === AttachmentTypes.MEDIA && draft.gif !== null) {
      if (draft.gif.stillGifUrl !== null) thumbnails = [draft.gif.stillGifUrl];
    } else if (attachmentType === AttachmentTypes.MEDIA && draft.images.length > 0) {
      thumbnails = draft.images.map((image) => image.url);
    } else if (attachmentType === AttachmentTypes.LINK && draft.link.thumbnail !== null) {
      thumbnails = [draft.link.thumbnail.url];
    } else if (attachmentType === AttachmentTypes.RETWEET && draft.retweet !== null) {
      thumbnails = [draft.retweet.avatarUrl];
    }
    return thumbnails;
  };

  getComposerFeedbackMessages = () => {
    // Message codes for which feedback shouldn't be displayed inside the composer
    const whatPreventsSavingIgnoredCodes = [1];

    return this.props.appState.whatPreventsSaving.filter((what) => (
      what.composerId === this.props.draft.id &&
      !whatPreventsSavingIgnoredCodes.includes(what.code)
    ));
  };

  getOmniboxNoticeTooltipMarkup = () => {
    const messages = this.props.visibleNotifications.reduce((notifMessages, notif) =>
            (notif.scope === NotificationScopes.MC_OMNIBOX_EDIT_NOTICE &&
            notif.data.id === this.props.draft.id ? notifMessages.concat(notif.message) :
            notifMessages), []);

    if (messages.length < 1) {
      return null;
    }

    return (
      ReactDOMServer.renderToStaticMarkup(
        <TooltipList messages={messages} />
      )
    );
  };

  getAlertIconTooltipMarkup = () => {
    const messages = this.props.appState.whatPreventsSaving.reduce((alertMessages, what) =>
        (what.composerId === this.props.draft.id ? alertMessages.concat(what.message) :
        alertMessages), []);

    if (messages.length < 1) {
      return null;
    }

    return (
      ReactDOMServer.renderToStaticMarkup(
        <TooltipList messages={messages} />
      )
    );
  };

  getSelectedProfilesForService = () =>
    this.props.selectedProfiles.filter((profile) =>
      profile.service.name === this.props.draft.id);

  getSelectedProfilesTooltipMarkup = () => {
    const selectedProfilesForService = this.getSelectedProfilesForService();
    return (
      ReactDOMServer.renderToStaticMarkup(
        <ComposerProfileTooltip
          selectedProfilesForService={selectedProfilesForService}
          key={this.props.draft.id}
        />
      )
    );
  };

  hasComposerAlerts = () =>
    this.props.appState.whatPreventsSaving.filter((what) =>
      what.composerId === this.props.draft.id).length > 0;

  hasOmniboxNotices = () =>
    this.props.visibleNotifications.some((notif) =>
      notif.scope === NotificationScopes.MC_OMNIBOX_EDIT_NOTICE &&
      notif.data.id === this.props.draft.id);

  isEnabled = () => this.props.draft.isEnabled || this.props.draft.service.isOmni;
  isExpanded = () => this.props.expandedComposerId === this.props.draft.id;

  isLinkAttachmentEnabled = () => this.props.draft.enabledAttachmentType === AttachmentTypes.LINK;
  isMediaAttachmentEnabled = () => this.props.draft.enabledAttachmentType === AttachmentTypes.MEDIA;
  isRetweetAttachmentEnabled = () =>
    this.props.draft.enabledAttachmentType === AttachmentTypes.RETWEET;

  hasLinkAttachment = () => this.props.draft.link !== null;

  hasMediaAttachment = () => (
    this.props.draft.images.length > 0 ||
    this.props.draft.video !== null ||
    this.props.draft.gif !== null
  );

  hasRetweetAttachment = () => this.props.draft.retweet !== null;

  hasAttachment = () => (
    (this.isLinkAttachmentEnabled() && this.hasLinkAttachment()) ||
    (this.isMediaAttachmentEnabled() && this.hasMediaAttachment()) ||
    (this.isRetweetAttachmentEnabled() && this.hasRetweetAttachment())
  );

  shouldShowMediaAttachmentSwitch = () => (
    !this.isMediaAttachmentEnabled() &&
    !this.isRetweetAttachmentEnabled() &&
    this.props.draft.service.canHaveSomeAttachmentType([
      AttachmentTypes.LINK,
      AttachmentTypes.RETWEET,
    ])
  );

  shouldShowLinkAttachmentSwitch = () =>
    this.isMediaAttachmentEnabled() && this.hasLinkAttachment();


  shouldShowRetweetAttachmentSwitch = () =>
    this.isMediaAttachmentEnabled() && this.hasRetweetAttachment();

  // Determine if that composer is displayed as "behind" another active composer
  isDisplayedBehind = () => this.props.expandedComposerId !== null && !this.isExpanded();

  isPinterest = () => this.props.draft.service.name === 'pinterest';

  hasAttachmentSwitch = () =>
    this.shouldShowRetweetAttachmentSwitch() ||
    this.shouldShowLinkAttachmentSwitch() ||
    this.shouldShowMediaAttachmentSwitch();

  expand = () => {
    if (this.isExpanded()) return;

    ComposerActionCreators.expand(this.props.draft.id);
    AppActionCreators.trackUserAction(['composer', 'expand']);
  };

  collapse = () => {
    ComposerActionCreators.collapse(this.props.draft.id);
  };

  toggleExpandedState = () => (this.isExpanded() ? this.collapse() : this.expand());

  removeNotice = (ev) => {
    ev.stopPropagation();
    NotificationActionCreators.removeComposerOmniboxNotices(this.props.draft.id);
    ReactTooltip.hide(this.noticeTooltip);
  };

  render() {
    if (!this.isEnabled()) return <div />;

    const {
      draft, profiles, visibleNotifications, appState, areAllDraftsSaved,
      shouldEnableFacebookAutocomplete, children, showTwitterImageDescription,
      shouldShowInlineSubprofileDropdown, composerPosition,
    } = this.props;

    const composerFeedbackMessages = this.getComposerFeedbackMessages();
    const shouldShowRetweetAttachment =
      this.isRetweetAttachmentEnabled() && this.hasRetweetAttachment();

    const hasComposerBeenCollapsed = appState.composersWhichHaveBeenCollapsed.has(draft.id);
    const isLocked = draft.isSaved;

    const editorPlaceholder = shouldShowRetweetAttachment ? 'Add a comment…' : undefined;
    const savedComposer = draft.isSaved;
    const attachmentGlanceHasNoThumbnail = this.getAttachmentThumbnails() === null;
    const hasOmniboxNotices = this.hasOmniboxNotices();
    const hasComposerAlerts = this.hasComposerAlerts();

    const shouldShowAlertIcons =
      hasComposerAlerts && appState.isOmniboxEnabled === false && hasComposerBeenCollapsed;

    const shouldShowOmniboxNotices =
      hasOmniboxNotices && !shouldShowAlertIcons && !this.isExpanded();

    const updateZoneClassName = [
      savedComposer ? styles.savedUpdateZone :
      this.isExpanded() ? styles.expandedUpdateZone : styles.updateZone,
      this.hasAttachment() && !this.isExpanded() ? styles.updateZoneWithAttachmentGlance : '',
      this.hasAttachment() && !this.isExpanded() && attachmentGlanceHasNoThumbnail ?
      styles.updateZoneAttachmentGlanceNoThumbnail : '',
      !this.isExpanded() &&
      (shouldShowOmniboxNotices || shouldShowAlertIcons) ?
      styles.updateZoneWithNotice : null,
      draft.hasSavingError ? styles.editableErrorUpdateZone : '',
      this.isDisplayedBehind() && isLocked ? styles.lockedDisplayedBehindAnotherZone :
      this.isDisplayedBehind() ? styles.displayedBehindAnotherUpdateZone : '',
    ].join(' ');

    const composerClassName = [
      this.isDisplayedBehind() ?
      styles.composerDisplayedBehindAnother : styles.composer,
      isLocked ? styles.lockedComposer : '',
      draft.service.isOmni ? styles.omnibox : '',
      'js-disable-dragging',
    ].join(' ');

    const attachmentSwitchIconClassName = [
      styles.attachmentSwitchIcon,
      'bi bi-image',
    ].join(' ');

    const linkAttachmentSwitchIconClassName = [
      styles.attachmentSwitchIcon,
      'bi  bi-link',
    ].join(' ');

    const mediaAttachmentSwitchCopy =
      this.isLinkAttachmentEnabled() && this.hasLinkAttachment() ?
        'Replace link attachment with image or video' :
      !this.isMediaAttachmentEnabled() ?
        'Add image or video' : '';

    const composerHiddenTitle = `${draft.service.name} composer`;

    const noticeClassNames = {
      container: styles.composerInfoMessageContainer,
      notification: styles.composerInfoMessage,
      notificationCloseButton: styles.composerInfoMessageCloseButton,
    };

    const inlineErrorClassNames = {
      notification: styles.inlineError,
    };

    const savedComposerFeedbackClassNames = [
      styles.savedComposerFeedback,
      'bi bi-checkmark',
    ].join(' ');

    const composerNotPrefilledNoticeScope =
      `${NotificationScopes.COMPOSER_NOTICE_NOT_PREFILLED}-${draft.service.name}`;
    const hasComposerNotPrefilledNotice =
      visibleNotifications.some((n) => n.scope === composerNotPrefilledNoticeScope);

    const shouldShowComposerFeedbackMessages = (
      this.isExpanded() &&
      composerFeedbackMessages.length > 0 &&
      hasComposerBeenCollapsed &&
      !appState.isOmniboxEnabled &&
      !hasComposerNotPrefilledNotice
    );

    const shouldShowComposerNotPrefilledNotice = this.isExpanded() && hasComposerNotPrefilledNotice;

    const addedToQueueCopyMap = new Map([
      [QueueingTypes.QUEUE, 'Added to queue!'],
      [QueueingTypes.NEXT, 'Added to queue!'],
      [QueueingTypes.NOW, 'Shared!'],
      [QueueingTypes.CUSTOM, 'Scheduled!'],
      [QueueingTypes.SAVE, 'Saved!'],
      [QueueingTypes.SAVE_AND_APPROVE, 'Saved!'],
    ]);

    const shouldShowCharacterCount =
      this.isExpanded() && draft.service.charLimit !== null &&
      draft.service.charLimit - draft.characterCount <= 280;

    const usesImageFirstLayout = draft.service.usesImageFirstLayout;
    const hasSuggestedMedia = this.getSuggestedMedia(true).length > 0;
    const suggestedMediaBoxClassName = [
      usesImageFirstLayout ? styles.imageFirstSuggestedMediaBox :
      !this.hasAttachmentSwitch() ?
      styles.suggestedMediaBoxAlignedBottom : '',
    ].join(' ');

    const mediaAttachmentClassName =
      usesImageFirstLayout ? styles.imageFirstMediaAttachment :
      hasSuggestedMedia ? styles.mediaAttachmentWithSuggestedMedia : '';

    const composerFooterClassName =
      usesImageFirstLayout ? styles.imageFirstFooter : styles.composerFooter;

    const composerMediaAttachment = (
      <MediaAttachment
        draftId={draft.id}
        tempImage={draft.tempImage}
        images={draft.images}
        video={draft.video}
        gif={draft.gif}
        service={draft.service}
        maxAttachableImagesCount={draft.service.maxAttachableImagesCount}
        fileUploadProgress={draft.fileUploadProgress}
        visibleNotifications={this.props.visibleNotifications}
        className={mediaAttachmentClassName}
        usesImageFirstLayout={usesImageFirstLayout}
        showTwitterImageDescription={showTwitterImageDescription}
        composerPosition={composerPosition}
      />
    );

    const composerEditor = (
      <Editor
        draft={draft}
        profiles={profiles}
        onFocus={this.onEditorFocus}
        placeholder={editorPlaceholder}
        isComposerExpanded={this.isExpanded()}
        shouldAutoFocus={this.state.shouldAutoFocusEditor}
        hasAttachmentGlance={this.hasAttachment()}
        hasLinkAttachment={this.isLinkAttachmentEnabled()}
        attachmentGlanceHasNoThumbnail={attachmentGlanceHasNoThumbnail}
        usesImageFirstLayout={usesImageFirstLayout}
        shouldEnableFacebookAutocomplete={shouldEnableFacebookAutocomplete}
        visibleNotifications={this.props.visibleNotifications}
        forceDecoratorsRerender={draft.forceDecoratorsRerender}
      />
    );

    const composerSuggestedMediaBox = (
      <SuggestedMediaBox
        draft={draft}
        draftId={draft.id}
        suggestedMedia={this.getSuggestedMedia(true)}
        className={suggestedMediaBoxClassName}
      />
    );

    const shouldShowMediaAttachment = this.isExpanded() && this.isMediaAttachmentEnabled();
    const shouldShowSuggestedMediaBox = (
      this.isExpanded() &&
      this.isMediaAttachmentEnabled() &&
      hasSuggestedMedia
    );

    const numSelectedProfiles = this.getSelectedProfilesForService().length;
    const networkIconTooltipContent = this.getSelectedProfilesTooltipMarkup();

    const sourceUrl = draft.sourceLink !== null ? draft.sourceLink.url : null;

    const socialNetworkIconClassName = [
      isLocked ? styles.lockedNetworkIcon :
      styles[`${draft.service.name}Icon`],
      numSelectedProfiles > 1 ? styles.iconWithProfileCount : '',
      `bi bi-circle-${draft.service.name}`,
    ].join(' ');


    const shouldDisplayCharCountAboveAttachment =
      shouldShowSuggestedMediaBox ||
      (this.isLinkAttachmentEnabled() && this.hasLinkAttachment()) ||
      (this.isRetweetAttachmentEnabled() && this.hasRetweetAttachment());

    const characterCountClassName =
      shouldDisplayCharCountAboveAttachment ? styles.aboveAttachmentCharCount :
      !shouldShowMediaAttachment ? styles.charCountNoMediaAttachment :
      styles.characterCount;

    const noticeIconClass = [
      'bi bi-notification',
      styles.noticeIcon,
    ].join(' ');

    const alertIconClass = [
      'bi bi-warning',
      styles.alertIcon,
    ].join(' ');

    const removeNoticeClass = [
      'bi bi-notification-close',
      styles.removeNoticeIcon,
    ].join(' ');

    return (
      <div className={composerClassName} onClick={this.onComposerClick}>
        <div
          className={socialNetworkIconClassName} onClick={this.onNetworkIconClick}
          data-profile-count={numSelectedProfiles} data-tip={networkIconTooltipContent} data-html
        />
        <div tabIndex="0" className={styles.hiddenA11yText} aria-label={composerHiddenTitle} />

        <div onClick={this.onUpdateZoneClick} className={updateZoneClassName}>
          {savedComposer && !areAllDraftsSaved &&
            <div className={savedComposerFeedbackClassNames}>
              {addedToQueueCopyMap.get(appState.draftSaveQueueingType)}
            </div>}
          { shouldShowOmniboxNotices &&
            <div
              data-tip={this.getOmniboxNoticeTooltipMarkup()} data-html
              className={noticeIconClass} ref={(node) => { this.noticeTooltip = node; }}
            >
              <Button onClick={this.removeNotice} className={removeNoticeClass} />
            </div>
          }
          {shouldShowAlertIcons && !this.isExpanded() &&
            <div
              data-tip={this.getAlertIconTooltipMarkup()} data-html
              className={alertIconClass}
            />
          }

          {shouldShowComposerFeedbackMessages &&
            composerFeedbackMessages.map((what) =>
              <div className={styles.composerFeedbackMessage} key={`${draft.id}-${what.message}`}>
                {what.message}
              </div>)}

          {shouldShowComposerNotPrefilledNotice &&
            <NotificationContainer
              visibleNotifications={visibleNotifications}
              scope={composerNotPrefilledNoticeScope}
              classNames={noticeClassNames}
              shouldShowCloseIcon
            />}

          {!usesImageFirstLayout && (
            <div className={styles.editorMediaContainer}>
              {composerEditor}

              {shouldShowCharacterCount &&
                <CharacterCount
                  count={draft.characterCount}
                  maxCount={draft.service.charLimit}
                  className={characterCountClassName}
                />}

              {shouldShowMediaAttachment &&
                <div className={styles.mediaWrapper}>
                  {composerMediaAttachment}
                  {shouldShowSuggestedMediaBox && composerSuggestedMediaBox}
                </div>}
            </div>
          )}

          {usesImageFirstLayout && (
            <div className={styles.imageFirstContainer}>
              <div className={styles.imageFirstWrapper}>
                {shouldShowMediaAttachment && composerMediaAttachment}
                {composerEditor}
              </div>

              {shouldShowCharacterCount &&
                <CharacterCount
                  count={draft.characterCount}
                  maxCount={draft.service.charLimit}
                  className={styles.imageFirstCharacterCount}
                />}

              {shouldShowSuggestedMediaBox && composerSuggestedMediaBox}
            </div>
          )}

          {this.isExpanded() && this.isLinkAttachmentEnabled() && this.hasLinkAttachment() &&
            <LinkAttachment
              link={draft.link} draftId={draft.id}
              service={draft.service} visibleNotifications={this.props.visibleNotifications}
              fileUploadProgress={draft.fileUploadProgress}
            />}

          {this.isExpanded() && shouldShowRetweetAttachment &&
            <RetweetAttachment retweet={draft.retweet} draftId={draft.id} />}

          {this.isExpanded() && (
            <div className={composerFooterClassName}>
              {this.shouldShowMediaAttachmentSwitch() && (
                <Button
                  onClick={this.onMediaAttachmentSwitchClick}
                  className={styles.attachmentSwitch}
                >
                  <i className={attachmentSwitchIconClassName} />
                  {mediaAttachmentSwitchCopy}
                </Button>
              )}

              {this.shouldShowLinkAttachmentSwitch() && (
                <Button
                  onClick={this.onLinkAttachmentSwitchClick}
                  className={styles.attachmentSwitch}
                >
                  <i className={linkAttachmentSwitchIconClassName} />
                  Replace with link attachment
                </Button>
              )}

              {this.shouldShowRetweetAttachmentSwitch() && (
                <Button
                  onClick={this.onRetweetAttachmentSwitchClick}
                  className={styles.attachmentSwitch}
                >
                  <i className={attachmentSwitchIconClassName} />
                  Replace with retweet
                </Button>
              )}

              {this.isPinterest() &&
                <PinterestComposerBar
                  profiles={profiles}
                  draftId={draft.id}
                  sourceUrl={sourceUrl}
                  shouldShowInlineSubprofileDropdown={shouldShowInlineSubprofileDropdown}
                  visibleNotifications={visibleNotifications}
                />}
            </div>
          )}

          {this.hasAttachment() && !this.isExpanded() &&
            <AttachmentGlance
              draft={draft}
              attachmentType={this.props.draft.enabledAttachmentType}
              attachmentThumbnails={this.getAttachmentThumbnails()}
            />}

          <NotificationContainer
            visibleNotifications={visibleNotifications}
            scope={`${NotificationScopes.UPDATE_SAVING}-${ErrorTypes.INLINE}-${draft.service.name}`}
            classNames={inlineErrorClassNames}
          />

          {children}
        </div>
      </div>
    );
  }
}

export default Composer;
