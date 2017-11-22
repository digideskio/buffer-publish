/**
 * Component that displays media suggestions and attachments
 */

import React from 'react';
import PropTypes from 'prop-types';
import { FileUploadFormatsConfigs, MediaTypes, UploadTypes } from '../AppConstants';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import MediaAttachmentThumbnail from '../components/MediaAttachmentThumbnail';
import MediaAttachmentEditor from '../components/MediaAttachmentEditor';
import UploadZone from '../components/UploadZone';
import CircularUploadIndicator from '../components/progress-indicators/CircularUploadIndicator';
import Dropdown, { DropdownTrigger, DropdownContent } from '../components/Dropdown';
import styles from './css/MediaAttachment.css';

class MediaAttachment extends React.Component {
  static propTypes = {
    draft: PropTypes.object.isRequired,
    draftId: PropTypes.string.isRequired,
    images: PropTypes.array.isRequired,
    video: PropTypes.object,
    gif: PropTypes.object,
    tempImage: PropTypes.string,
    maxAttachableImagesCount: PropTypes.number.isRequired,
    fileUploadProgress: PropTypes.number,
    service: PropTypes.object,
    visibleNotifications: PropTypes.array.isRequired,
    className: PropTypes.string,
    usesImageFirstLayout: PropTypes.bool,
    showTwitterImageDescription: PropTypes.bool.isRequired,
    composerPosition: PropTypes.object,
  };

  static defaultProps = {
    composerPosition: null,
  };

  hasImagesAttached = () => this.props.images.length > 0;
  hasVideoAttached = () => this.props.video !== null;
  hasGifAttached = () => this.props.gif !== null;

  collapseAttachedMediaEditor = () => {
    ComposerActionCreators.updateDraftAttachedMediaEditingPayload(this.props.draftId, null);
  }

  expandAttachedMediaEditor = () => {
    ComposerActionCreators.updateDraftAttachedMediaEditingPayload(this.props.draftId, this.props.video);
  }

  onVideoEditButtonClick = () => {
    const isAlreadyEditingMedia = this.props.draft.attachedMediaEditingPayload !== null;
    const payload = isAlreadyEditingMedia ? null : this.props.video;
    ComposerActionCreators.updateDraftAttachedMediaEditingPayload(this.props.draftId, payload);
  };

  render() {
    const {
      images, video, gif, tempImage, draftId, showTwitterImageDescription, maxAttachableImagesCount,
      fileUploadProgress, service, className, usesImageFirstLayout, composerPosition, draft,
    } = this.props;

    const shouldDisplayUploadNewButton = (
      maxAttachableImagesCount > images.length &&
      video === null &&
      gif === null
    );

    const isUploadInProgress = fileUploadProgress !== null;

    const uploadNewButtonTooltipCopy = 'Upload image or video';

    const uploadNewButtonUIClassName = [
      isUploadInProgress ? styles.uploadNewButtonUIIsUploading :
      tempImage ? styles.uploadNewButtonUIWithTempImage : styles.uploadNewButtonUI,
      usesImageFirstLayout ? styles.imageFirstUploadButtonUI : '',
      'bi bi-add-media',
    ].join(' ');

    const uploadFormatsConfig = new Map(FileUploadFormatsConfigs.MEDIA); // Clone config

    service.unavailableMediaAttachmentTypes.forEach((mediaType) => {
      uploadFormatsConfig.delete(mediaType);
    });

    const thumbnailClassName = usesImageFirstLayout ? styles.imageFirstThumbnail : styles.thumbnail;

    const mediaAttachmentClassNames = [
      styles.mediaAttachment,
      className,
    ].join(' ');

    const uploadZoneClassNames = {
      uploadZone: styles.uploadZone,
      uploadZoneActive: [styles.activeDrop, 'bi bi-add-media'].join(' '),
    };

    const editButtonClass = `${styles.editButton} bi bi-edit`;

    return (
      <div className={mediaAttachmentClassNames}>
        {this.hasImagesAttached() &&
          images.map((image) =>
            <MediaAttachmentThumbnail
              draftId={draftId}
              className={thumbnailClassName}
              key={image.url}
              media={image}
              showTwitterImageDescription={showTwitterImageDescription}
              composerPosition={composerPosition}
            />)}

        {this.hasVideoAttached() && (
          <Dropdown
            isDropdownExpanded={draft.attachedMediaEditingPayload !== null}
            onHide={this.collapseAttachedMediaEditor}
            onShow={this.expandAttachedMediaEditor}
            className={styles.editButtonContainer}
          >
            <DropdownTrigger
              className={editButtonClass}
              data-tip="Edit video details"
              aria-label="Click to edit video details"
            />
            <DropdownContent>
              {draft.attachedMediaEditingPayload !== null &&
                <MediaAttachmentEditor draft={draft} onSubmit={this.collapseAttachedMediaEditor} />}
            </DropdownContent>
          </Dropdown>
        )}

        {this.hasVideoAttached() &&
          <MediaAttachmentThumbnail
            draftId={draftId}
            className={thumbnailClassName}
            key={video.thumbnail}
            media={video}
            showTwitterImageDescription={showTwitterImageDescription}
            composerPosition={composerPosition}
          />}

        {this.hasGifAttached() &&
          <MediaAttachmentThumbnail
            draftId={draftId}
            className={thumbnailClassName}
            key={gif.url}
            media={gif}
            showTwitterImageDescription={showTwitterImageDescription}
            composerPosition={composerPosition}
          />}

        {shouldDisplayUploadNewButton &&
          <div className={uploadNewButtonUIClassName} data-tip={uploadNewButtonTooltipCopy}>
            {tempImage && !isUploadInProgress &&
              <div className={styles.tempImageContainer}>
                <img alt="" src={tempImage} className={styles.tempImage} />
              </div>}

            <UploadZone
              classNames={uploadZoneClassNames}
              draftId={draftId}
              uploadFormatsConfig={uploadFormatsConfig}
              service={this.props.service}
              visibleNotifications={this.props.visibleNotifications}
              uploadType={UploadTypes.MEDIA}
            />

            {isUploadInProgress &&
              <CircularUploadIndicator size={54} progress={fileUploadProgress} showText />}
          </div>}
      </div>

    );
  }
}

export default MediaAttachment;
