import React from 'react';
import PropTypes from 'prop-types';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import ModalActionCreators from '../__legacy-buffer-web-shared-components__/modal/actionCreators';
import Button from '../components/Button';
import Input from '../components/Input';
import styles from './css/ImageDescriptionInput.css';

class ImageDescriptionInput extends React.Component {
  static propTypes = {
    draftId: PropTypes.string,
    mediaAttachment: PropTypes.object,
  };

  constructor(props) {
    super(props);
    this.state = {
      description: this.props.mediaAttachment.description || '',
      saveButtonText: 'Save',
    };
  }

  handleChange = (e) => {
    this.setState({
      description: e.target.value,
      saveButtonText: 'Save',
    });
  }

  componentDidUpdate = (prevProps, prevState) => {
    if (prevState.saveButtonText === 'Save' && this.state.saveButtonText === 'Saved!') {
      setTimeout(() => {
        ModalActionCreators.closeModal();
      }, 800);
    }
  };

  onClick = () => {
    ComposerActionCreators.updateImageDescription(this.props.mediaAttachment, this.state.description);
    this.setState({ saveButtonText: 'Saved!' });
  }

  render() {
    return (
      <div className={styles.container}>
        <Input
          className={styles.textInput} type="text"
          value={this.state.description} onChange={this.handleChange}
          placeholder="Add a description for people with visual impairments"
        />
        <Button className={styles.button} onClick={this.onClick}>
          {this.state.saveButtonText}
        </Button>
      </div>
    );
  }
}

export default ImageDescriptionInput;
