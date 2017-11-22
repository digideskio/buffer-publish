import React from 'react';
import PropTypes from 'prop-types';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import Button from '../components/Button';
import Input from '../components/Input';
import styles from './css/MediaAttachmentEditor.css';

const onSuggestedThumbnailClick = (draft, thumbnail) => {
  ComposerActionCreators.updateDraftVideoThumbnail(draft.id, thumbnail);
};

const onTitleChange = (draft, e) => {
  ComposerActionCreators.updateDraftVideoTitle(draft.id, e.target.value);
};

const onThumbnailMouseOver = (draft, thumbnail) => {
  ComposerActionCreators.updateDraftTempImage(draft.id, thumbnail);
};

const onThumbnailMouseOut = (draft) => {
  ComposerActionCreators.removeDraftTempImage(draft.id);
};

const MediaAttachmentEditor = ({ draft, onMouseOut, className }) => {
  const { attachedMediaEditingPayload: video } = draft;

  return (
    <div className={`${styles.container} ${className}`} onMouseOut={onMouseOut}>
      <label className={styles.header} htmlFor="video-title-input">Title:</label>
      <Input
        type="text"
        value={video.name}
        onChange={onTitleChange.bind(this, draft)}
        id="video-title-input"
        className={styles.input}
      />
      <p className={styles.header}>Thumbnail:</p>
      <div className={styles.scrollContainer}>
        {video.availableThumbnails.map((thumbnail) => (
          <Button
            className={thumbnail === video.thumbnail ? `${styles.selectedThumbnailContainer} bi bi-checkmark` : styles.thumbnailContainer}
            onClick={onSuggestedThumbnailClick.bind(this, draft, thumbnail)}
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

MediaAttachmentEditor.propTypes = {
  draft: PropTypes.object.isRequired,
  onMouseOut: PropTypes.func,
  className: PropTypes.string,
};

MediaAttachmentEditor.defaultProps = {
  onMouseOut: () => {},
  className: '',
};

export default MediaAttachmentEditor;
