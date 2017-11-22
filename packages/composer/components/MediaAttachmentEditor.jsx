import React from 'react';
import PropTypes from 'prop-types';
import ImagesLoadEvents from '@bufferapp/react-images-loaded';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import Button from '../components/Button';
import Input from '../components/Input';
import { scrollIntoView } from '../utils/DOMUtils';
import styles from './css/MediaAttachmentEditor.css';

class MediaAttachmentEditor extends React.Component {
  static propTypes = {
    draft: PropTypes.object.isRequired,
    onMouseOut: PropTypes.func,
    onSubmit: PropTypes.func,
    className: PropTypes.string,
  };

  static defaultProps = {
    onMouseOut: () => {},
    onSubmit: () => {},
    className: '',
  };

  onAllThumbnailImagesLoadEvents = () => {
    scrollIntoView({
      el: this.selectedThumbnailEl,
      ref: this.scrollContainerEl,
      axis: 'horizontal',
      padding: 25,
    });
  }

  onSuggestedThumbnailClick = (draft, thumbnail) => {
    ComposerActionCreators.updateDraftVideoThumbnail(draft.id, thumbnail);
  };

  onTitleChange = (draft, e) => {
    ComposerActionCreators.updateDraftVideoTitle(draft.id, e.target.value);
  };

  onThumbnailMouseOver = (draft, thumbnail) => {
    ComposerActionCreators.updateDraftTempImage(draft.id, thumbnail);
  };

  onThumbnailMouseOut = (draft) => {
    ComposerActionCreators.removeDraftTempImage(draft.id);
  };

  render() {
    const { draft, onMouseOut, onSubmit, className } = this.props;
    const { attachedMediaEditingPayload: video } = draft;

    return (
      <div className={`${styles.container} ${className}`} onMouseOut={onMouseOut}>
        <label className={styles.header} htmlFor="video-title-input">Title:</label>
        <Input
          type="text"
          value={video.name}
          onChange={this.onTitleChange.bind(this, draft)}
          id="video-title-input"
          className={styles.input}
        />
        <p className={styles.header}>Thumbnail:</p>
        <div
          className={styles.scrollContainer}
          ref={(ref) => { this.scrollContainerEl = ref; }}
        >
          <ImagesLoadEvents onAlways={this.onAllThumbnailImagesLoadEvents}>
            {video.availableThumbnails.map((thumbnail) => (
              <Button
                className={thumbnail === video.thumbnail ? `${styles.selectedThumbnailContainer} bi bi-checkmark` : styles.thumbnailContainer}
                ref={(ref) => { if (thumbnail === video.thumbnail) this.selectedThumbnailEl = ref; }}
                onClick={this.onSuggestedThumbnailClick.bind(this, draft, thumbnail)}
                onMouseOver={this.onThumbnailMouseOver.bind(this, draft, thumbnail)} // eslint-disable-line
                onMouseMove={this.onThumbnailMouseOver.bind(this, draft, thumbnail)} // eslint-disable-line
                onMouseOut={this.onThumbnailMouseOut.bind(this, draft)}
                key={thumbnail}
              >
                <img
                  src={thumbnail}
                  className={styles.thumbnail}
                  alt="Suggested thumbnail for video"
                />
              </Button>
            ))}
          </ImagesLoadEvents>
        </div>
        <Button onClick={onSubmit} className={styles.submitButton}>Done</Button>
      </div>
    );
  }
}

export default MediaAttachmentEditor;
