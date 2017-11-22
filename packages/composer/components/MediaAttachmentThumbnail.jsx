import React from 'react';
import PropTypes from 'prop-types';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import AppActionCreators from '../action-creators/AppActionCreators';
import CloseButton from '../components/CloseButton';
import Button from '../components/Button';
import { escapeParens } from '../utils/StringUtils';
import { MediaTypes } from '../AppConstants';
import styles from './css/MediaAttachmentThumbnail.css';
import ModalActionCreators from '../__legacy-buffer-web-shared-components__/modal/actionCreators';

class MediaAttachmentThumbnail extends React.Component {
  static propTypes = {
    draftId: PropTypes.string.isRequired,
    className: PropTypes.string,
    media: PropTypes.object.isRequired,
    showTwitterImageDescription: PropTypes.bool.isRequired,
    composerPosition: PropTypes.object,
    canEditVideoAttachment: PropTypes.bool,
  };

  static defaultProps = {
    composerPosition: null,
    canEditVideoAttachment: null,
  };

  onClick = () => {
    const { media, draftId, showTwitterImageDescription, composerPosition } = this.props;
    ModalActionCreators.openModal('MediaZoomBox', {
      media, draftId, showTwitterImageDescription, composerPosition,
    });
  }

  onCloseButtonClick = () => {
    const { draftId, media } = this.props;

    switch (media.mediaType) {
      case MediaTypes.IMAGE:
        ComposerActionCreators.removeDraftImage(draftId, media);
        AppActionCreators.trackUserAction(['composer', 'media', 'removed', 'photo'], {
          isGif: false,
        });
        break;

      case MediaTypes.VIDEO:
        ComposerActionCreators.removeDraftVideo(draftId);
        AppActionCreators.trackUserAction(['composer', 'media', 'removed', 'video']);
        break;

      case MediaTypes.GIF:
        ComposerActionCreators.removeDraftGif(draftId);
        AppActionCreators.trackUserAction(['composer', 'media', 'removed', 'photo'], {
          isGif: true,
        });
        break;

      default:
        break;
    }
  };

  render() {
    const { media, className, showTwitterImageDescription, canEditVideoAttachment } = this.props;
    const thumbnailClassName = [styles.thumbnail, className].join(' ');
    const isVideo = media.mediaType === MediaTypes.VIDEO;
    const isRegularImage = media.mediaType === MediaTypes.IMAGE;
    const thumbnail = isVideo ? media.thumbnail : media.url;

    const videoThumbnailClass = canEditVideoAttachment ?
      `${styles.editableVideoThumbnail} bi bi-video` :
      `${styles.videoThumbnail} bi bi-video`;
    const tooltipCopy = (isRegularImage && showTwitterImageDescription) ?
      'Click to expand & add description' : 'Click to expand';
    const ariaLabel = (isRegularImage && showTwitterImageDescription) ?
      'Select to expand image and add image description' :
      `Select to expand ${isVideo ? 'video' : 'image'}`;

    return (
      <div className={thumbnailClassName}>
        <Button
          className={styles.imageContainer}
          aria-label={ariaLabel}
          data-tip={tooltipCopy} onClick={this.onClick}
          style={{ backgroundImage: `url(${escapeParens(thumbnail)})` }}
        >
          {isVideo &&
            <span className={videoThumbnailClass} aria-label="video attachment" />}
        </Button>

        <CloseButton
          className={styles.closeButton} onClick={this.onCloseButtonClick} label="Remove media"
        />
      </div>
    );
  }
}

export default MediaAttachmentThumbnail;
