/*
 * "Linked chats" player dialog: shows and overrides the YouTube / Kick channel linked to the Twitch streamer of chat 0.
 * Rows and Apply are pure (no DOM); the rest drives the dialog with the TV remote.
 */

//Variable initialization
var ChatLinkDialog_IsVisible = false;
var ChatLinkDialog_Login = '';
var ChatLinkDialog_RowsData = [];
var ChatLinkDialog_Focus = 0;
var ChatLinkDialog_Editing = '';
var ChatLinkDialog_InputTimer = null;
var ChatLinkDialog_PanelWasShowing = false;
var ChatLinkDialog_OriginControl = -1;
//Variable initialization end

function ChatLinkDialog_Rows(entry, resolved) {
    var yt = resolved && resolved.yt,
        kick = resolved && resolved.kick,
        rows = [
            {kind: 'yt', label: 'YouTube', value: yt ? yt.value : '', source: yt ? yt.source : 'none'},
            {kind: 'kick', label: 'Kick', value: kick ? kick.value : '', source: kick ? kick.source : 'none'},
            {kind: 'enabled', label: STR_CHAT_LINK_ENABLED, value: entry.enabled === false ? STR_NO : STR_YES, source: ''}
        ];

    if (typeof entry.yt === 'string' || typeof entry.kick === 'string') {
        rows.push({kind: 'reset', label: STR_CHAT_LINK_RESET, value: '', source: ''});
    }
    rows.push({kind: 'close', label: STR_CLOSE, value: '', source: ''});

    return rows;
}

//Saves a manual value: normalized, '' = do not link. Returns false (nothing saved) for unusable input
function ChatLinkDialog_Apply(login, kind, rawInput) {
    var text = String(rawInput || '').replace(/^\s+|\s+$/g, ''),
        value,
        entry;

    if (kind !== 'yt' && kind !== 'kick') return false;

    if (text === '') value = '';
    else {
        value = kind === 'yt' ? ChatLink_NormalizeYouTube(text) : ChatLink_NormalizeKick(text);
        if (!value) return false;
    }

    entry = ChatLink_Get(login);
    entry[kind] = value;
    ChatLink_Save(login, entry);
    return true;
}

function ChatLinkDialog_Restart() {
    ChatMulti_Restart(0);
    if (PlayExtra_PicturePicture && ChatLive_selectedChannel[1] && ChatLive_selectedChannel[1] === ChatLinkDialog_Login) ChatMulti_Restart(1);
}

function ChatLinkDialog_SourceText(source) {
    return source === 'dir' ? STR_CHAT_LINK_FROM_DIR : source === 'manual' ? STR_CHAT_LINK_MANUAL : source === 'none' ? STR_CHAT_LINK_NONE : '';
}

function ChatLinkDialog_Render() {
    var holder = Main_getElementById('chat_link_rows'),
        i,
        row,
        div,
        text;

    ChatLinkDialog_RowsData = ChatLinkDialog_Rows(ChatLink_Get(ChatLinkDialog_Login), ChatLink_Current(0));
    if (ChatLinkDialog_Focus >= ChatLinkDialog_RowsData.length) ChatLinkDialog_Focus = ChatLinkDialog_RowsData.length - 1;

    Main_emptyWithEle(holder);

    for (i = 0; i < ChatLinkDialog_RowsData.length; i++) {
        row = ChatLinkDialog_RowsData[i];
        div = document.createElement('div');
        div.className = 'strokedelinebig chat_link_row' + (i === ChatLinkDialog_Focus ? ' button_dialog_focused' : '');

        //Only textContent: channel names and handles are untrusted
        text = row.label;
        if (row.kind === 'yt' || row.kind === 'kick') {
            text += ': ' + (row.value ? row.value + ' (' + ChatLinkDialog_SourceText(row.source) + ')' : ChatLinkDialog_SourceText(row.source));
            text += ' – ' + STR_CHAT_LINK_EDIT;
        } else if (row.value) text += ': ' + row.value;

        div.textContent = text;
        holder.appendChild(div);
    }
}

function ChatLinkDialog_Show() {
    var login = ChatLive_selectedChannel[0];

    if (!login) {
        Play_showWarningMiddleDialog(STR_CHAT_LINK_NO_CHANNEL, 2000);
        return;
    }

    if (typeof PlayerUI_SuspendPhone === 'function') PlayerUI_SuspendPhone();

    //Take remote input ownership: the player panel cannot act beneath the dialog
    Main_removeEventListener('keydown', Play_handleKeyDown);
    Main_addEventListener('keydown', ChatLinkDialog_HandleKeyDown);

    //Remember the panel state so Close can restore focus to the originating control
    ChatLinkDialog_PanelWasShowing = !!Play_isPanelShowing();
    ChatLinkDialog_OriginControl = Play_PanelCounter;

    Play_clearHidePanel();
    Play_hidePanel();

    ChatLinkDialog_Login = login;
    ChatLinkDialog_Focus = 0;
    ChatLinkDialog_Editing = '';

    Main_textContent('chat_link_title', STR_CHAT_LINKED);
    Main_textContent('chat_link_channel', Play_data.data[1] + ' (' + login + ')');
    Main_HideElement('chat_link_input_holder');
    ChatLinkDialog_Render();

    ChatLinkDialog_IsVisible = true;
    Main_ShowElement('dialog_chat_link');
}

function ChatLinkDialog_Hide(skipFocusRestore) {
    if (!ChatLinkDialog_IsVisible && !Main_isElementShowing('dialog_chat_link')) return;

    if (ChatLinkDialog_Editing) ChatLinkDialog_InputClose(false);

    ChatLinkDialog_IsVisible = false;
    Main_HideElement('dialog_chat_link');
    Main_removeEventListener('keydown', ChatLinkDialog_HandleKeyDown);

    //Restore player input/focus only while the player still exists
    if (Play_isOn && !skipFocusRestore) {
        Main_PlayHandleKeyDown();

        if (ChatLinkDialog_PanelWasShowing) {
            Play_ForceShowPannel();

            if (ChatLinkDialog_OriginControl > -1 && Play_controls[ChatLinkDialog_OriginControl] && Play_controls[ChatLinkDialog_OriginControl].visible) {
                Play_PanelCounter = ChatLinkDialog_OriginControl;
            }

            Play_IconsAddFocus();
            Play_ResetPanel(1);
        } else if (Play_isPanelShowing()) {
            Play_IconsAddFocus();
        }
    }

    ChatLinkDialog_PanelWasShowing = false;
    ChatLinkDialog_OriginControl = -1;
    if (typeof PlayerUI_ResumePhone === 'function') PlayerUI_ResumePhone(skipFocusRestore);
}

//Player teardown hook: idempotent, never reattaches player input
function ChatLinkDialog_Cleanup() {
    ChatLinkDialog_Hide(true);
}

function ChatLinkDialog_Move(step) {
    var next = ChatLinkDialog_Focus + step;

    if (next < 0 || next >= ChatLinkDialog_RowsData.length) return;
    ChatLinkDialog_Focus = next;
    ChatLinkDialog_Render();
}

function ChatLinkDialog_Activate() {
    var row = ChatLinkDialog_RowsData[ChatLinkDialog_Focus],
        entry;

    if (!row) return;

    switch (row.kind) {
        case 'yt':
        case 'kick':
            ChatLinkDialog_InputOpen(row);
            break;
        case 'enabled':
            entry = ChatLink_Get(ChatLinkDialog_Login);
            entry.enabled = entry.enabled === false;
            ChatLink_Save(ChatLinkDialog_Login, entry);
            ChatLinkDialog_Restart();
            ChatLinkDialog_Render();
            break;
        case 'reset':
            //Back to the directory values, the enabled switch is kept
            entry = ChatLink_Get(ChatLinkDialog_Login);
            delete entry.yt;
            delete entry.kick;
            ChatLink_Save(ChatLinkDialog_Login, entry);
            ChatLinkDialog_Restart();
            ChatLinkDialog_Render();
            break;
        default:
            ChatLinkDialog_Hide();
            break;
    }
}

function ChatLinkDialog_HandleKeyDown(e) {
    e.stopPropagation();

    switch (e.keyCode) {
        case KEY_UP:
            ChatLinkDialog_Move(-1);
            break;
        case KEY_DOWN:
            ChatLinkDialog_Move(1);
            break;
        case KEY_ENTER:
            ChatLinkDialog_Activate();
            break;
        case KEY_KEYBOARD_BACKSPACE:
        case KEY_RETURN:
            ChatLinkDialog_Hide();
            break;
        case KEY_STOP:
            //Exit playback: close cleanly first, then let the player handle the key
            ChatLinkDialog_Hide();
            Main_PlayHandleKeyDown();
            Play_handleKeyDown(e);
            break;
        default:
            break;
    }
}

function ChatLinkDialog_InputOpen(row) {
    var input = Main_getElementById('chat_link_input'),
        entry = ChatLink_Get(ChatLinkDialog_Login);

    ChatLinkDialog_Editing = row.kind;
    Main_removeEventListener('keydown', ChatLinkDialog_HandleKeyDown);
    Main_textContent('chat_link_input_label', row.label);
    input.value = typeof entry[row.kind] === 'string' ? entry[row.kind] : row.value;
    Main_ShowElement('chat_link_input_holder');

    ChatLinkDialog_InputTimer = Main_setTimeout(
        function () {
            if (!ChatLinkDialog_Editing) return;
            OSInterface_AvoidClicks(true);
            input.focus();
            if (Main_IsOn_OSInterface) {
                if (OptionsShowObj.keyboard_options.defaultValue === 1) OSInterface_KeyboardCheckAndHIde();
                else if (OptionsShowObj.keyboard_options.defaultValue === 2) OSInterface_hideKeyboardFrom();
            }
            Main_addEventListener('keydown', ChatLinkDialog_InputKey);
        },
        200,
        ChatLinkDialog_InputTimer
    );
}

//Closes the input; backToDialog gives the remote back to the dialog, otherwise the caller (Hide) hands it to the player
function ChatLinkDialog_InputClose(backToDialog) {
    var input = Main_getElementById('chat_link_input');

    ChatLinkDialog_Editing = '';
    Main_clearTimeout(ChatLinkDialog_InputTimer);
    Main_removeEventListener('keydown', ChatLinkDialog_InputKey);
    input.blur();
    OSInterface_AvoidClicks(false);
    Main_HideElement('chat_link_input_holder');

    if (backToDialog) Main_addEventListener('keydown', ChatLinkDialog_HandleKeyDown);
}

function ChatLinkDialog_InputKey(e) {
    e.stopPropagation();

    switch (e.keyCode) {
        case KEY_KEYBOARD_DONE:
        case KEY_ENTER:
            if (ChatLinkDialog_Apply(ChatLinkDialog_Login, ChatLinkDialog_Editing, Main_getElementById('chat_link_input').value)) {
                ChatLinkDialog_InputClose(true);
                ChatLinkDialog_Restart();
                ChatLinkDialog_Render();
            } else {
                Play_showWarningMiddleDialog(STR_CHAT_LINK_INVALID, 2000);
            }
            break;
        case KEY_RETURN:
            ChatLinkDialog_InputClose(true);
            break;
        case KEY_STOP:
            ChatLinkDialog_InputClose(true);
            ChatLinkDialog_HandleKeyDown(e);
            break;
        default:
            break;
    }
}
