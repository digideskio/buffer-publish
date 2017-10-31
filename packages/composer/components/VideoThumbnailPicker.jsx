import React from 'react';
import PropTypes from 'prop-types';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import Button from '../components/Button';
import styles from './css/VideoThumbnailPicker.css';

const onSuggestedThumbnailClick = (draft, video, thumbnail) => {
  ComposerActionCreators.addDraftVideo(draft.id, { video, thumbnail });
};

const onThumbnailMouseOver = (draft, thumbnail) => {
  ComposerActionCreators.updateDraftTempImage(draft.id, thumbnail);
};

const onThumbnailMouseOut = (draft) => {
  ComposerActionCreators.removeDraftTempImage(draft.id);
};

const VideoThumbnailPicker = ({ draft, onMouseOut, className }) => {
  const { videoThumbnailPickerPayload: video } = draft;

  return (
    <div className={`${styles.container} ${className}`} onMouseOut={onMouseOut}>
      <p className={styles.header}>Pick a thumbnail:</p>
      <div className={styles.scrollContainer}>
        {video.availableThumbnails.map((thumbnail) => (
          <Button
            className={thumbnail === video.thumbnail ? `${styles.selectedThumbnailContainer} bi bi-checkmark` : styles.thumbnailContainer}
            onClick={onSuggestedThumbnailClick.bind(this, draft, video, thumbnail)}
            onMouseOver={onThumbnailMouseOver.bind(this, draft, thumbnail)} // eslint-disable-line
            onMouseMove={onThumbnailMouseOver.bind(this, draft, thumbnail)} // eslint-disable-line
            onMouseOut={onThumbnailMouseOut.bind(this, draft)}
            key={thumbnail}
          >
            <img src={thumbnail} className={styles.thumbnail} alt="Suggested thumbnail for video" />
          </Button>
        ))}
      </div>
    </div>
  );
};

VideoThumbnailPicker.propTypes = {
  draft: PropTypes.object.isRequired,
  onMouseOut: PropTypes.func,
  className: PropTypes.string,
};

VideoThumbnailPicker.defaultProps = {
  onMouseOut: () => {},
  className: '',
};

export default VideoThumbnailPicker;
