/**
 * Component that displays and allows to navigate among a provided list
 * of suggested media
 */

import React from 'react';
import PropTypes from 'prop-types';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import styles from './css/LinkAttachmentThumbnailEditor.css';
import { FileUploadFormatsConfigs, UploadTypes } from '../AppConstants';
import UploadZone from '../components/UploadZone';
import Button from '../components/Button';
import CircularUploadIndicator from '../components/progress-indicators/CircularUploadIndicator';

class LinkAttachmentThumbnailEditor extends React.Component {
  static propTypes = {
    draftId: PropTypes.string.isRequired,
    selectedThumbnail: PropTypes.object,
    availableThumbnails: PropTypes.array,
    fileUploadProgress: PropTypes.number,
    visibleNotifications: PropTypes.array,
    service: PropTypes.object,
    hasThumbnail: PropTypes.bool,
  };

  selectPreviousThumbnail = () =>
    ComposerActionCreators.selectPreviousLinkThumbnail(this.props.draftId);

  selectNextThumbnail = () =>
    ComposerActionCreators.selectNextLinkThumbnail(this.props.draftId);

  render() {
    const { selectedThumbnail, fileUploadProgress, availableThumbnails } = this.props;

    const scrollLeftButtonClassName = [
      styles.scrollLeftButton,
      'bi bi-arrow-left',
      styles.scrollButton,
    ].join(' ');

    const scrollRightButtonClassName = [
      styles.scrollRightButton,
      'bi bi-arrow-right',
      styles.scrollButton,
    ].join(' ');

    const progressIndicatorClassName = { container: styles.progressIndicator };

    const uploadFormatsConfig = new Map(FileUploadFormatsConfigs.IMAGE);
    const isUploadInProgress = fileUploadProgress !== null;
    const hasThumbnail = selectedThumbnail !== null;
    const hasMoreThanOneThumbnail = availableThumbnails !== null && availableThumbnails.length > 1;

    const uploadZoneClassName = [
      'bi bi-add-media',
      styles.uploadZone,
      hasThumbnail ? '' : styles.noSuggestedImages,
      isUploadInProgress ? styles.uploadInProgress : '',
    ].join(' ');

    const uploadZoneClassNames = {
      uploadZone: uploadZoneClassName,
      uploadZoneActive: styles.activeDrop,
    };

    const thumbnailStyles =
      isUploadInProgress ? styles.uploadingThumbnail : styles.thumbnail;


    return (
      <div className={styles.thumbnailEditorContainer}>
        {hasThumbnail &&
          <div
            className={thumbnailStyles}
            style={{ backgroundImage: `url(${selectedThumbnail.url})` }}
            role="img" aria-label="Link Thumbnail"
          />}

        <UploadZone
          classNames={uploadZoneClassNames}
          draftId={this.props.draftId}
          uploadFormatsConfig={uploadFormatsConfig}
          service={this.props.service}
          visibleNotifications={this.props.visibleNotifications}
          uploadType={UploadTypes.LINK_THUMBNAIL}
        />

        {isUploadInProgress &&
          <CircularUploadIndicator
            size={54} progress={this.props.fileUploadProgress} showText
            classNames={progressIndicatorClassName}
          />}

        {hasMoreThanOneThumbnail &&
          <Button
            className={scrollLeftButtonClassName} onClick={this.selectPreviousThumbnail}
            aria-label="Scroll suggested media left"
          />}

        {hasMoreThanOneThumbnail &&
          <Button
            className={scrollRightButtonClassName} onClick={this.selectNextThumbnail}
            aria-label="Scroll suggested media right"
          />}
      </div>
    );
  }
}

export default LinkAttachmentThumbnailEditor;
