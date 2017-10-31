import React from 'react';
import PropTypes from 'prop-types';
import Immutable from 'immutable';
import { RichUtils, Modifier, EditorState } from '@bufferapp/draft-js';
import DraftjsEditor from '@bufferapp/draft-js-plugins-editor';
import createMentionPlugin from '@bufferapp/draft-js-mention-plugin';
import twitterText from 'twitter-text';
import AppActionCreators from '../action-creators/AppActionCreators';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import NotificationActionCreators from '../action-creators/NotificationActionCreators';
import WebAPIUtils from '../utils/WebAPIUtils';
import CompositeNestableDecorator
  from '../utils/draft-js-custom-plugins/draft-decorator/CompositeNestableDecorator';
import createShortLinkPlugin from '../utils/draft-js-custom-plugins/short-link';
import createUnshortenedLinkPlugin from '../utils/draft-js-custom-plugins/unshortened-link';
import createLinkDecoratorPlugin from '../utils/draft-js-custom-plugins/link';
import createMentionDecoratorPlugin from '../utils/draft-js-custom-plugins/mention';
import createHashtagDecoratorPlugin from '../utils/draft-js-custom-plugins/hashtag';
import createHighlighterPlugin from '../utils/draft-js-custom-plugins/highlighter';
import getAutocompleteSuggestionsPosition
  from '../utils/draft-js-custom-plugins/autocomplete/utils/positionSuggestions';
import TwitterAutocompleteSuggestionsEntry
  from '../utils/draft-js-custom-plugins/autocomplete/TwitterMentionSuggestionsEntry';
import TwitterHashtagAutocompleteSuggestionsEntry
  from '../utils/draft-js-custom-plugins/autocomplete/TwitterHashtagSuggestionsEntry';
import FacebookAutocompleteSuggestionsEntry
  from '../utils/draft-js-custom-plugins/autocomplete/FacebookMentionSuggestionsEntry';
import createPrepopulatedMentionPlugin
  from '../utils/draft-js-custom-plugins/prepopulated-autocomplete-mention';
import createPrepopulatedHashtagPlugin
  from '../utils/draft-js-custom-plugins/prepopulated-autocomplete-hashtag';
import createImportedFacebookMentionPlugin
  from '../utils/draft-js-custom-plugins/imported-facebook-mention-entities';
import createInspectSelectionPlugin from '../utils/draft-js-custom-plugins/inspect-selection';
import { NotificationScopes, QueueingTypes } from '../AppConstants';

import styles from './css/Editor.css';
import twitterAutocompleteStyles
  from '../utils/draft-js-custom-plugins/autocomplete/TwitterAutocomplete.css';
import twitterHashtagAutocompleteStyles
  from '../utils/draft-js-custom-plugins/autocomplete/TwitterHashtagAutocomplete.css';
import facebookAutocompleteStyles
  from '../utils/draft-js-custom-plugins/autocomplete/FacebookAutocomplete.css';
import { getDraftCharacterCount } from '../stores/ComposerStore';

class Editor extends React.Component {
  static propTypes = {
    draft: PropTypes.object.isRequired,
    isComposerExpanded: PropTypes.bool.isRequired,
    shouldEnableFacebookAutocomplete: PropTypes.bool.isRequired,
    visibleNotifications: PropTypes.array.isRequired,
    profiles: PropTypes.array,
    shouldAutoFocus: PropTypes.bool,
    onFocus: PropTypes.func,
    placeholder: PropTypes.string,
    hasAttachmentGlance: PropTypes.bool,
    attachmentGlanceHasNoThumbnail: PropTypes.bool,
    hasLinkAttachment: PropTypes.bool,
    usesImageFirstLayout: PropTypes.bool,
    readOnly: PropTypes.bool,
  };

  static defaultProps = {
    shouldAutoFocus: false,
    onFocus: () => {},
    placeholder: 'What would you like to share?',
  };

  constructor(props) {
    super(props);

    const { editorPlugins, editorPluginsComponents, editorPluginsUtils } =
      this.createEditorPlugins();
    Object.assign(this, { editorPlugins, editorPluginsComponents, editorPluginsUtils });
  }

  state = {
    autocompleteSearchQuery: '',
    autocompleteSuggestions: Immutable.fromJS([]),
    hashtagAutocompleteSearchQuery: '',
    hashtagAutocompleteSuggestions: Immutable.fromJS([]),
  };

  componentWillReceiveProps(nextProps) {
    if (nextProps.forceDecoratorsRerender) {
      nextProps.draft.forceDecoratorsRerender = false; // Mutating through shared reference
      this.refs.textZone.rerenderDecorators();
    }
  }

  componentDidUpdate() {
    /**
    * Autofocusing is slightly delayed so that the underlying DraftjsEditor
    * component has the time to initialize entirely before the focus event
    * makes it mutate its EditorState. See #11466
    */
    if (this.props.shouldAutoFocus) {
      setTimeout(() => this.refs.textZone && this.refs.textZone.focus(), 0);
    }
  }

  onKeyDown = (e) => {
    // Space/Enter: parse links
    if (e.key === ' ' || e.key === 'Enter') {
      this.parseDraftTextLinks();
    // Backspace: parse links, if not in the process of backspacing through a link
    } else if (e.key === 'Backspace') {
      setImmediate(() => {
        const characterBefore = this.editorPluginsUtils.getCharacterBeforeSelectionStart();
        const hasCharacterBefore = characterBefore !== null;
        const isCharacterBeforeWhitespace = twitterText.regexen.spaces.test(characterBefore);

        if (!hasCharacterBefore || isCharacterBeforeWhitespace) this.parseDraftTextLinks();
      });
    }
  };

  onPaste = () => this.parseDraftTextLinks();
  onDrop = () => this.parseDraftTextLinks();
  onCut = () => this.parseDraftTextLinks();

  onClick = (e) => {
    e.preventDefault();
    this.props.onFocus(e);
  };

  onEditorStateChange = (editorState) => {
    // Only update editorState when necessary to prevent a rare race condition with
    // draft-js-mention-plugin, but still re-render whenever onEditorStateChange is
    // called because the nested AutocompleteSuggestions components need to in order
    // for keyboard navigation within suggestions to work
    const hasActuallyChanged = editorState !== this.props.draft.editorState;
    if (!hasActuallyChanged) {
      this.forceUpdate();
      return;
    }

    ComposerActionCreators.updateDraftEditorState(this.props.draft.id, editorState);
  };

  onFocus = (e) => this.props.onFocus(e);

  onAutocompleteSearchChange = (() => {
    let currentValue;

    return ({ value }, searchType = 'mentions') => {
      const searchQueryKey = searchType === 'mentions' ?
        'autocompleteSearchQuery' : 'hashtagAutocompleteSearchQuery';

      const suggestionsKey = searchType === 'mentions' ?
        'autocompleteSuggestions' : 'hashtagAutocompleteSuggestions';

      // Only query for suggestions after users enter 2 or more characters
      if (!value || value.length < 2) {
        this.setState({
          [searchQueryKey]: value,
          [suggestionsKey]: Immutable.fromJS([]),
        });
        return;
      }

      // Don't run the Facebook Autocomplete if there isn't at least one Facebook page selected
      if (this.props.draft.service.name === 'facebook' && searchType === 'mentions') {
        const hasSelectedFbPages =
          this.props.profiles.some((p) => (
            p.isSelected &&
            p.service.name === 'facebook' &&
            p.serviceType === 'page'
          ));

        if (!hasSelectedFbPages) {
          this.setState({
            [searchQueryKey]: value,
            [suggestionsKey]: Immutable.fromJS([]),
          });
          return;
        }
      }

      this.setState({ [searchQueryKey]: value });

      currentValue = value;

      const suggestionsStream =
        WebAPIUtils.getAutocompleteSuggestions(this.props.draft.service.name, value, searchType);

      (async () => {
        for await (const suggestions of suggestionsStream) {
          const doSuggestionsStillMatchSearch = value === currentValue;

          if (doSuggestionsStillMatchSearch) {
            this.setState({
              [suggestionsKey]: Immutable.fromJS([...suggestions.values()]),
            });
          }
        }
      })().catch((error) => {
        const alreadyHasSameAutocompleteNotif = this.props.visibleNotifications.some((notif) => (
          notif.scope === NotificationScopes.AUTOCOMPLETE &&
          notif.message === error.message
        ));

        if (!alreadyHasSameAutocompleteNotif) {
          NotificationActionCreators.queueError({
            scope: NotificationScopes.AUTOCOMPLETE,
            message: error.message,
          });
        }
      });
    };
  })();

  onHashtagAutocompleteSearchChange = (...args) => (
    this.onAutocompleteSearchChange(...args, 'hashtags')
  );

  onAutocompleteOpen = () => {
    this.isAutocompleteOpen = true;
  };

  onHashtagAutocompleteOpen = () => {
    this.isHashtagAutocompleteOpen = true;
  };

  onAutocompleteClose = () => {
    this.isAutocompleteOpen = false;

    // A small issue with draft-js-mention-plugin@2.0.0-beta10 makes resetting the
    // list of suggestions necessary upon closing. TODO: Remove when fixed.
    // See https://github.com/draft-js-plugins/draft-js-plugins/issues/687
    this.setState({
      autocompleteSuggestions: Immutable.fromJS([]),
    });
  };

  onHashtagAutocompleteClose = () => {
    this.isHashtagAutocompleteOpen = false;

    // A small issue with draft-js-mention-plugin@2.0.0-beta10 makes resetting the
    // list of suggestions necessary upon closing. TODO: Remove when fixed.
    // See https://github.com/draft-js-plugins/draft-js-plugins/issues/687
    this.setState({
      hashtagAutocompleteSuggestions: Immutable.fromJS([]),
    });
  };

  onLinkUnshortened = (unshortenedLink) => {
    ComposerActionCreators.draftTextLinkUnshortened(
      this.props.draft.id, unshortenedLink);
  };

  onLinkShortened = (unshortenedLink, shortLink) => {
    ComposerActionCreators.draftTextLinkShortened(
      this.props.draft.id, unshortenedLink, shortLink);
  };

  onLinkReshortened = (unshortenedLink, shortLink) => {
    ComposerActionCreators.draftTextLinkReshortened(
      this.props.draft.id, unshortenedLink, shortLink);
  };

  getAutocompleteSuggestionsNotice = () => {
    // Only show notices after users enter 2 or more characters
    if (this.state.autocompleteSearchQuery.length < 2) return '';

    // Display notices for Facebook Autocomplete's special cases
    if (this.props.draft.service.name === 'facebook') {
      const selectedFbAccounts =
        this.props.profiles.filter((p) => (
          p.isSelected &&
          p.service.name === 'facebook'
        ));

      const hasSelectedFbProfiles = selectedFbAccounts.some((p) => p.serviceType === 'profile');
      const hasSelectedFbPages = selectedFbAccounts.some((p) => p.serviceType === 'page');

      if (hasSelectedFbProfiles && hasSelectedFbPages) {
        return `Only Facebook pages can add tags:
                Facebook profiles will see regular text instead.`;
      } else if (hasSelectedFbProfiles && !hasSelectedFbPages) {
        // This was broken after updating draft-js-mention-plugin to latest: disabled
        // in the meantime to prevent uwnanted visual artifacts
        // TODO: rebuild that functionality another way now that the plugin behaves differently

        /* return `Sorry, we can’t add tags on posts from Facebook profiles (just pages).
                Your tag will show up as regular text.`; */
      }
    }

    return '';
  };

  handleReturn = (e) => {
    // Give control to mention plugin if it's active (to select the suggestion)
    if (this.isAutocompleteOpen || this.isHashtagAutocompleteOpen) {
      return 'not-handled';
    }

    // Save drafts ("Share Now") on Ctrl/Cmd + Shift + Enter
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      AppActionCreators.saveDrafts(QueueingTypes.NOW, { shouldSkipEmptyTextAlert: false });
      return 'handled';
    }

    // Save drafts ("Add to Queue") on Ctrl/Cmd + Enter
    if (e.ctrlKey || e.metaKey) {
      AppActionCreators.saveDrafts(undefined, { shouldSkipEmptyTextAlert: false });
      // TODO: default to whatever firstButtonType is in UpdateSaver.jsx
      return 'handled';
    }

    // Else if we're going to insert a new line, make it a soft one. We need soft
    // new lines for the highlighter plugin to work. Without them, due to the way
    // draft-js works, applying the highlighter decorator (which needs access to
    // an accurate character count) on a just-modified paragraph doesn't work as
    // expected if multiple paragraphs are at play, because a decorator strategy
    // only has access to an up-to-date version of the content block being edited;
    // the wider content state (that contains the other content blocks) isn't
    // updated until later. Moreover, when a change happens, decorator strategies
    // are only re-applied to the block that changed, not others. With soft new lines,
    // we only ever deal with a single content block, which means we always have access
    // to an accurate character count, and the decorator is re-applied consistently.
    // If hard new lines were used, multiple content blocks would be involved, and
    // we'd need to force full re-renders on each key stroke for the two reasons
    // mentioned above, which leads to all sorts of side-effects with EditorState.
    // tl;dr: soft new lines ftw!
    this.onEditorStateChange(RichUtils.insertSoftNewline(this.props.draft.editorState));
    return 'handled';
  };

  handlePastedText = (text) => {
    const { editorState } = this.props.draft;
    const contentState = Modifier.replaceText(
      editorState.getCurrentContent(),
      editorState.getSelection(),
      text
    );

    this.onEditorStateChange(EditorState.push(editorState, contentState, 'insert-fragment'));

    return 'handled';
  };

  parseDraftTextLinks = () => setImmediate(() => {
    ComposerActionCreators.parseDraftTextLinks(this.props.draft.id);
  });

  createEditorPlugins = () => {
    const editorPlugins = [];
    const editorPluginsComponents = {};
    const editorPluginsUtils = {};

    // Create short link plugin
    const shortLinkPlugin = createShortLinkPlugin();
    editorPlugins.push(shortLinkPlugin);
    editorPluginsComponents.ShortLinkTooltip = shortLinkPlugin.ShortLinkTooltip;

    // Create unshortened link plugin
    const unshortenedLinkPlugin = createUnshortenedLinkPlugin();
    editorPlugins.push(unshortenedLinkPlugin);
    editorPluginsComponents.UnshortenedLinkTooltip = unshortenedLinkPlugin.UnshortenedLinkTooltip;

    // Create link plugin to decorate non-entity links
    const linkPlugin = createLinkDecoratorPlugin();
    editorPlugins.push(linkPlugin);

    // Create inspect-selection plugin to hook a util function into the editor
    const inspectSelectionPlugin = createInspectSelectionPlugin();
    editorPlugins.push(inspectSelectionPlugin);
    editorPluginsUtils.getCharacterBeforeSelectionStart =
      inspectSelectionPlugin.getCharacterBeforeSelectionStart;

    // Create highlighter plugin
    if (this.props.draft.service.charLimit !== null) {
      const highlighterPlugin = createHighlighterPlugin(this.props.draft, getDraftCharacterCount);
      editorPlugins.push(highlighterPlugin);
    }

    // Create Twitter autocomplete plugin that only handles prepopulated mentions
    if (this.props.draft.service.name === 'twitter') {
      const prepopulatedMentionPlugin = createPrepopulatedMentionPlugin();
      editorPlugins.push(prepopulatedMentionPlugin);
    }

    // Create Twitter autocomplete plugin that only handles prepopulated hashtags
    if (this.shouldEnableHashtagAutocomplete()) {
      const prepopulatedHashtagPlugin = createPrepopulatedHashtagPlugin();
      editorPlugins.push(prepopulatedHashtagPlugin);
    }

    // Create Facebook autocomplete plugin that only handles imported mentions
    if (this.props.draft.service.name === 'facebook') {
      const importedFacebookMentionPlugin = createImportedFacebookMentionPlugin();
      editorPlugins.push(importedFacebookMentionPlugin);
    }

    // Create autocomplete plugin that handles mentions typed by users
    if (this.shouldEnableAutocomplete()) {
      const getDecoratorParentRect = () => this.refs.editorWrapper.getBoundingClientRect();
      const autocompletePlugin = createMentionPlugin({
        theme: (
          this.props.draft.service.name === 'twitter' ? twitterAutocompleteStyles :
          this.props.draft.service.name === 'facebook' ? facebookAutocompleteStyles : null
        ),
        positionSuggestions: getAutocompleteSuggestionsPosition.bind(null, getDecoratorParentRect),
        entityMutability: 'IMMUTABLE',
      });

      editorPlugins.push(autocompletePlugin);
      editorPluginsComponents.AutocompleteSuggestions = autocompletePlugin.MentionSuggestions;
      editorPluginsComponents.AutocompleteSuggestionsEntry = (
        this.props.draft.service.name === 'twitter' ? TwitterAutocompleteSuggestionsEntry :
        this.props.draft.service.name === 'facebook' ? FacebookAutocompleteSuggestionsEntry : null
      );

      this.isAutocompleteOpen = false;
    }

    // Create autocomplete plugin that handles hashtags typed by users
    if (this.shouldEnableHashtagAutocomplete()) {
      const getDecoratorParentRect = () => this.refs.editorWrapper.getBoundingClientRect();
      const hashtagAutocompletePlugin = createMentionPlugin({
        theme: twitterHashtagAutocompleteStyles,
        positionSuggestions: getAutocompleteSuggestionsPosition.bind(null, getDecoratorParentRect),
        entityMutability: 'IMMUTABLE',
        mentionTrigger: '#',
      });

      editorPlugins.push(hashtagAutocompletePlugin);
      editorPluginsComponents.HashtagAutocompleteSuggestions = hashtagAutocompletePlugin.MentionSuggestions;
      editorPluginsComponents.HashtagAutocompleteSuggestionsEntry = TwitterHashtagAutocompleteSuggestionsEntry;

      this.isHashtagAutocompleteOpen = false;
    }

    // Create Twitter mention plugin to decorate non-entity mentions
    if (this.props.draft.service.name === 'twitter') {
      const mentionPlugin = createMentionDecoratorPlugin();
      editorPlugins.push(mentionPlugin);
    }

    // Create Twitter hashtag plugin to decorate non-entity hashtags
    if (this.shouldEnableHashtagAutocomplete()) {
      const hashtagPlugin = createHashtagDecoratorPlugin();
      editorPlugins.push(hashtagPlugin);
    }

    return { editorPlugins, editorPluginsComponents, editorPluginsUtils };
  };

  shouldEnableAutocomplete = () => (
    this.props.draft.service.name === 'twitter' ||
    (this.props.draft.service.name === 'facebook' && this.props.shouldEnableFacebookAutocomplete)
  );

  shouldEnableHashtagAutocomplete = () => this.props.draft.service.name === 'twitter';

  render() {
    const {
      draft, isComposerExpanded, placeholder, usesImageFirstLayout,
      attachmentGlanceHasNoThumbnail, readOnly,
    } = this.props;

    const {
      ShortLinkTooltip, UnshortenedLinkTooltip, AutocompleteSuggestions,
      AutocompleteSuggestionsEntry, HashtagAutocompleteSuggestions,
      HashtagAutocompleteSuggestionsEntry,
    } = this.editorPluginsComponents;

    const textZoneClassName = [
      this.props.hasLinkAttachment && isComposerExpanded ?
      [styles.expandedTextZone, styles.hasLinkAttachment].join(' ') :
      isComposerExpanded ? styles.expandedTextZone :
      attachmentGlanceHasNoThumbnail ?
      [styles.hasAttachmentGlanceNoThumbnail, styles.collapsedTextZone].join(' ') :
      this.props.hasAttachmentGlance ?
      [styles.hasAttachmentGlance, styles.collapsedTextZone].join(' ') :
      styles.collapsedTextZone,
    ].join(' ');

    const textZoneTooltipClassNames = {
      visible: styles.visibleTextZoneTooltip,
      hidden: styles.hiddenTextZoneTooltip,
    };

    const editorWrapperClassName =
      usesImageFirstLayout ? styles.imageFirstEditorWrapper : styles.editorWrapper;

    return (
      <div className={editorWrapperClassName} ref="editorWrapper">
        <div
          className={textZoneClassName} onKeyDown={this.onKeyDown}
          onPaste={this.onPaste} onCut={this.onCut}
          onDrop={this.onDrop} onClick={this.onClick}
          onFocus={this.onFocus}
        >
          <DraftjsEditor
            editorState={draft.editorState}
            onChange={this.onEditorStateChange}
            placeholder={placeholder}
            plugins={this.editorPlugins}
            CompositeDraftDecorator={CompositeNestableDecorator}
            spellCheck
            stripPastedStyles
            readOnly={readOnly}
            handleReturn={this.handleReturn}
            handlePastedText={this.handlePastedText}
            ref="textZone"
          />
        </div>

        {isComposerExpanded && this.shouldEnableAutocomplete() &&
          <AutocompleteSuggestions
            onSearchChange={this.onAutocompleteSearchChange}
            onOpen={this.onAutocompleteOpen}
            onClose={this.onAutocompleteClose}
            suggestions={this.state.autocompleteSuggestions}
            entryComponent={AutocompleteSuggestionsEntry}
            data-notice={this.getAutocompleteSuggestionsNotice()}
            data-suggestions-count={this.state.autocompleteSuggestions.size}
          />}

        {isComposerExpanded && this.shouldEnableHashtagAutocomplete() &&
          <HashtagAutocompleteSuggestions
            onSearchChange={this.onHashtagAutocompleteSearchChange}
            onOpen={this.onHashtagAutocompleteOpen}
            onClose={this.onHashtagAutocompleteClose}
            suggestions={this.state.hashtagAutocompleteSuggestions}
            entryComponent={HashtagAutocompleteSuggestionsEntry}
          />}

        {isComposerExpanded &&
          <ShortLinkTooltip
            classNames={textZoneTooltipClassNames}
            onLinkUnshortened={this.onLinkUnshortened}
          />}
        {isComposerExpanded &&
          <UnshortenedLinkTooltip
            classNames={textZoneTooltipClassNames}
            onLinkReshortened={this.onLinkReshortened}
          />}
      </div>
    );
  }
}

export default Editor;
