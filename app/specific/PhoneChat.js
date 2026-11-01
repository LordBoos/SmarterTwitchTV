/*
 * Copyright (c) 2017-∞ Felipe de Leon <fglfgl27@gmail.com>
 *
 * This file is part of SmartTwitchTV <https://github.com/fgl27/SmartTwitchTV>
 *
 * SmartTwitchTV is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SmartTwitchTV is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with SmartTwitchTV.  If not, see <https://github.com/fgl27/SmartTwitchTV/blob/master/LICENSE>.
 *
 */

/*
 * "Chat on phone" - TV side.
 *
 * Opens a pairing QR for the APK's LAN server and publishes the current live
 * channel. The QR carries an app pairing capability, never a Twitch token.
 * The phone performs its own independent Twitch device login.
 *
 * Depends on: PhoneChatConfig* globals (app/general/PhoneChatConfig.js) and
 * the vendored ES5 QR generator (app/thirdparty/qrcode.js, global qrcode()).
 */

var PhoneChat_IsVisible = false;
var PhoneChat_QrCanvas = null;
var PhoneChat_PanelWasShowing = false;
var PhoneChat_OriginControl = -1;
var PhoneChat_PublishTimer = null;

function PhoneChat_PublishChannel() {
    var eligible = Play_isOn && !PlayVod_isOn && !PlayClip_isOn && !Play_MultiEnable;
    var channel = eligible ? PhoneChat_GetChannel() : null;
    OSInterface_SetPhoneChatChannel(channel);
    PhoneChat_Collect(channel);
}

//Twitch logins are 3-25 chars of letters, digits and underscore (case insensitive)
function PhoneChat_NormalizeLogin(login) {
    if (typeof login !== 'string') return null;

    var value = login.trim();

    if (!/^[a-zA-Z0-9_]{3,25}$/.test(value)) return null;

    return value.toLowerCase();
}

//The primary channel login lives in Play_data.data[6] (data[1] is the display name)
function PhoneChat_GetChannel() {
    if (!Play_isOn || !Play_data || !Play_data.data || Play_data.data.length < 7) return null;
    //The phone chat page is Twitch only
    if (Play_data.data[19] === 'kick') return null;

    return PhoneChat_NormalizeLogin(Play_data.data[6]);
}

function PhoneChat_BuildUrlFromLogin(login) {
    //Canonical URL from configuration only: never from window.location, the TV
    //can be serving from app assets or an alternate origin
    return PhoneChatConfig.pageUrl + '?channel=' + encodeURIComponent(login);
}

function PhoneChat_BuildUrl() {
    var channel = PhoneChat_GetChannel();

    if (!channel) return null;
    if (Main_IsOn_OSInterface) {
        var url = OSInterface_GetPhoneChatUrl();
        if (!/^http:\/\/[0-9.]+:8978\/chat\/#pair=[a-f0-9]{64}$/.test(url)) return null;
        PhoneChat_PublishChannel();
        if (!PhoneChat_PublishTimer) PhoneChat_PublishTimer = setInterval(PhoneChat_PublishChannel, 2000);
        return url;
    }
    return PhoneChat_BuildUrlFromLogin(channel);
}

function PhoneChat_IsQrLibraryAvailable() {
    return typeof qrcode === 'function';
}

//Draw the QR locally on a canvas: sharp modules, >=4 module quiet zone, no interpolation
function PhoneChat_DrawQr(canvas, url) {
    var qr,
        modules,
        quiet = 4,
        target = 400,
        cell,
        size,
        context,
        row,
        col;

    qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();

    modules = qr.getModuleCount();
    cell = Math.max(2, Math.floor(target / (modules + quiet * 2)));
    size = cell * (modules + quiet * 2);

    canvas.width = size;
    canvas.height = size;

    context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#000000';

    for (row = 0; row < modules; row++) {
        for (col = 0; col < modules; col++) {
            if (qr.isDark(row, col)) {
                context.fillRect((col + quiet) * cell, (row + quiet) * cell, cell, cell);
            }
        }
    }
}

function PhoneChat_Toggle(e) {
    e.preventDefault();
    //A held number key must not repeatedly open and close the dialog.
    if (e.repeat) return;

    if (PhoneChat_IsVisible) PhoneChat_Hide();
    else if (
        Play_isOn &&
        !PlayVod_isOn &&
        !PlayClip_isOn &&
        !Play_MultiEnable &&
        !Play_isEndDialogVisible() &&
        !Play_MultiDialogVisible() &&
        !UserLiveFeed_isPreviewShowing()
    ) {
        PhoneChat_Show();
    }
}

function PhoneChat_Show() {
    var url = PhoneChat_BuildUrl(),
        canvas;

    if (!url) {
        Play_showWarningMiddleDialog(PhoneChat_GetChannel() ? STR_PHONE_CHAT_LOCAL_FAIL : STR_PHONE_CHAT_NO_CHANNEL, 5000);
        return;
    }

    if (!PhoneChat_IsQrLibraryAvailable()) {
        Play_showWarningMiddleDialog(STR_PHONE_CHAT_FAIL, 1500);
        return;
    }

    if (typeof PlayerUI_SuspendPhone === 'function') PlayerUI_SuspendPhone();

    //Take remote input ownership: the player panel cannot act beneath the dialog
    Main_removeEventListener('keydown', Play_handleKeyDown);
    Main_addEventListener('keydown', PhoneChat_HandleKeyDown);

    //Remember the panel state so Close can restore focus to the originating
    //control (Play_hidePanel resets the panel's focus position)
    PhoneChat_PanelWasShowing = !!Play_isPanelShowing();
    PhoneChat_OriginControl = Play_PanelCounter;

    //Cancel the normal player panel auto-dismiss while the dialog is open
    Play_clearHidePanel();
    Play_hidePanel();

    Main_textContent('phone_chat_title', STR_PHONE_CHAT_OPEN);
    Main_textContent('phone_chat_channel', Play_data.data[1] + ' (' + PhoneChat_GetChannel() + ')');
    Main_textContent('phone_chat_instruction', STR_PHONE_CHAT_INSTRUCTION);
    Main_textContent('phone_chat_rescan', Main_IsOn_OSInterface ? STR_PHONE_CHAT_FOLLOWS : STR_PHONE_CHAT_RESCAN);
    Main_textContent('phone_chat_url', url);
    Main_textContent('phone_chat_close', STR_PHONE_CHAT_CLOSE + ' (6)');

    canvas = Main_getElementById('phone_chat_qr');
    PhoneChat_QrCanvas = canvas;

    try {
        PhoneChat_DrawQr(canvas, url);
    } catch (e) {
        Main_textContent('phone_chat_url', url);
    }

    PhoneChat_IsVisible = true;
    Main_ShowElement('dialog_phone_chat');
    Main_AddClass('phone_chat_close', 'button_dialog_focused');
}

function PhoneChat_Hide(skipFocusRestore) {
    if (!PhoneChat_IsVisible && !Main_isElementShowing('dialog_phone_chat')) return;

    PhoneChat_IsVisible = false;
    PhoneChat_QrCanvas = null;

    Main_RemoveClass('phone_chat_close', 'button_dialog_focused');
    Main_HideElement('dialog_phone_chat');

    //Clear the QR surface so no stale link lingers in memory of the reader
    var canvas = Main_getElementById('phone_chat_qr');
    if (canvas && canvas.getContext) {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }

    Main_removeEventListener('keydown', PhoneChat_HandleKeyDown);

    //Restore player input/focus only while the player still exists
    if (Play_isOn && !skipFocusRestore) {
        Main_PlayHandleKeyDown();

        if (PhoneChat_PanelWasShowing) {
            //Bring the panel back with focus on the control that opened the
            //dialog, and re-arm its normal auto-dismiss
            Play_ForceShowPannel();

            if (PhoneChat_OriginControl > -1 && Play_controls[PhoneChat_OriginControl] && Play_controls[PhoneChat_OriginControl].visible) {
                Play_PanelCounter = PhoneChat_OriginControl;
            }

            Play_IconsAddFocus();
            Play_ResetPanel(1);
        } else if (Play_isPanelShowing()) {
            Play_IconsAddFocus();
        }
    }

    PhoneChat_PanelWasShowing = false;
    PhoneChat_OriginControl = -1;
    if (typeof PlayerUI_ResumePhone === 'function') PlayerUI_ResumePhone(skipFocusRestore);
}

function PhoneChat_HandleKeyDown(e) {
    e.stopPropagation();

    switch (e.keyCode) {
        case KEY_NUMPAD_6:
        case KEY_6:
            PhoneChat_Toggle(e);
            break;
        case KEY_ENTER:
            //The only focused action: Close
            PhoneChat_Hide();
            break;
        case KEY_KEYBOARD_BACKSPACE:
        case KEY_RETURN:
            PhoneChat_Hide();
            break;
        case KEY_STOP:
            //Exit playback: close cleanly first, then let the player handle the key
            PhoneChat_Hide();
            Main_PlayHandleKeyDown();
            Play_handleKeyDown(e);
            break;
        default:
            break;
    }
}

//Player teardown hook: idempotent, safe to call during exit/shutdown/stream
//replacement; never reattaches player input after the player went away
function PhoneChat_Cleanup() {
    PhoneChat_Hide(true);

    //Only touch the native side when phone chat was actually in use
    if (PhoneChat_PublishTimer || PhoneChat_HistorySocket) {
        if (PhoneChat_PublishTimer) {
            clearInterval(PhoneChat_PublishTimer);
            PhoneChat_PublishTimer = null;
        }
        OSInterface_SetPhoneChatChannel('');
        PhoneChat_Collect(null);
    }
}

//Independent anonymous connection: continues collecting when TV chat is hidden.
var PhoneChat_HistorySocket = null;
var PhoneChat_HistoryChannel = null;
var PhoneChat_HistoryRetryAt = 0;

function PhoneChat_Collect(channel) {
    if (channel !== PhoneChat_HistoryChannel) {
        if (PhoneChat_HistorySocket) PhoneChat_HistorySocket.close();
        PhoneChat_HistorySocket = null;
        PhoneChat_HistoryChannel = channel;
        PhoneChat_HistoryRetryAt = 0;
    }
    if (!channel || PhoneChat_HistorySocket || Date.now() < PhoneChat_HistoryRetryAt) return;
    var socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443', 'irc'),
        buffer = '';
    PhoneChat_HistorySocket = socket;
    socket.onopen = function () {
        if (socket !== PhoneChat_HistorySocket) return;
        socket.send('CAP REQ :twitch.tv/commands twitch.tv/tags');
        socket.send('PASS SCHMOOPIIE');
        socket.send('NICK justinfan' + Math.floor(Math.random() * 1000000));
        socket.send('JOIN #' + channel);
    };
    socket.onmessage = function (event) {
        if (socket !== PhoneChat_HistorySocket) return;
        buffer += event.data;
        var lines = buffer.split('\r\n'),
            i,
            message,
            tags,
            login,
            badges,
            bots,
            payload;
        buffer = lines.pop();
        if (buffer.length > 8192) {
            buffer = '';
            socket.close();
            return;
        }
        for (i = 0; i < lines.length; i++) {
            message = window.parseIRC(lines[i]);
            tags = message.tags || {};
            if (message.command === 'PING') {
                socket.send('PONG :' + message.params[0]);
                continue;
            }
            if (message.command === 'RECONNECT') {
                socket.close();
                continue;
            }
            payload = null;
            if (message.command === 'PRIVMSG' && message.params[0] === '#' + channel) {
                login = String(message.prefix || '')
                    .split('!')[0]
                    .toLowerCase();
                badges = String(tags.badges || '').split(',');
                bots = ['nightbot', 'streamelements', 'wizebot', 'wisebot', 'moobot', 'fossabot'];
                if (
                    bots.indexOf(login) !== -1 ||
                    !tags.id ||
                    (badges.indexOf('partner/1') === -1 &&
                        badges.indexOf('verified/1') === -1 &&
                        badges.indexOf('vip/1') === -1 &&
                        badges.indexOf('moderator/1') === -1)
                )
                    continue;
                payload = {
                    type: 'message',
                    message: {
                        id: tags.id,
                        login: login,
                        displayName: tags['display-name'] || login,
                        text: message.params[1],
                        badges: tags.badges,
                        color: tags.color,
                        emotes: tags.emotes,
                        tags: {'user-id': tags['user-id']}
                    }
                };
            } else if (message.command === 'CLEARMSG') payload = {type: 'delete', id: tags['target-msg-id']};
            else if (message.command === 'CLEARCHAT') payload = {type: 'clear', userId: tags['target-user-id'] || ''};
            if (payload) OSInterface_AddPhoneChatHistory(channel, JSON.stringify(payload));
        }
    };
    socket.onerror = function () {
        socket.close();
    };
    socket.onclose = function () {
        if (socket !== PhoneChat_HistorySocket) return;
        PhoneChat_HistorySocket = null;
        PhoneChat_HistoryRetryAt = Date.now() + 5000;
    };
}
