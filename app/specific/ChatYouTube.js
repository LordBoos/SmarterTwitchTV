/*
 * YouTube chat source of the merged chat: finds the live video of a channel, reads the chat page (history and
 * innertube data) and polls get_live_chat. Everything from YouTube is untrusted: names and header texts are escaped,
 * images come from whitelisted hosts only, background colors are rebuilt from a number. Every async path and every
 * timer checks ChatMulti_IsActive(chat_number, seq). Failures are silent, the only reaction is a retry timer.
 */

//Variable initialization
var ChatYouTube_State = []; // per chat_number {seq, target, withHistory, loaded, key, context, continuation, timers}
var ChatYouTube_PollMs = 1000;
var ChatYouTube_RetryMs = 120000;
var ChatYouTube_Headers = [
    ['User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'],
    ['Cookie', 'SOCS=CAI']
];
var ChatYouTube_ImageHostRegex = /^(yt3\.ggpht\.com|yt4\.ggpht\.com|[a-z0-9-]+\.googleusercontent\.com|www\.youtube\.com|www\.gstatic\.com)$/;
var ChatYouTube_TargetRegex = /^(UC[\w-]{20,30}|@[^\s\/\\?#&"'<>%]{1,60})$/;
var ChatYouTube_PageUrl = 'https://www.youtube.com/live_chat?is_popout=1&v=';
var ChatYouTube_PollUrl = 'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false&key=';
var ChatYouTube_Badge_Icons = {OWNER: 'owner', MODERATOR: 'mod', VERIFIED: 'verified'};
//Variable initialization end

function ChatYouTube_Start(chat_number, seq, target, withHistory) {
    ChatYouTube_Stop(chat_number);
    if (!ChatYouTube_TargetRegex.test(target)) return;

    var st = {
        seq: seq,
        target: target,
        withHistory: withHistory,
        loaded: false,
        polled: false,
        lastTs: 0,
        key: '',
        context: null,
        continuation: '',
        timers: []
    };
    ChatYouTube_State[chat_number] = st;

    ChatYouTube_FindLive(chat_number, st);
}

function ChatYouTube_Stop(chat_number) {
    var st = ChatYouTube_State[chat_number];
    ChatYouTube_State[chat_number] = null;
    if (!st) return;

    var i = 0;
    for (i; i < st.timers.length; i++) Main_clearTimeout(st.timers[i]);
    st.timers = [];
}

// The session is still current: not stopped, restarted, replaced or switched away
function ChatYouTube_Current(chat_number, seq) {
    var st = ChatYouTube_State[chat_number];
    return st && st.seq === seq && ChatMulti_IsActive(chat_number, seq) ? st : null;
}

// Every timer of the slot goes through here so Stop can clear it and a stale one does nothing
function ChatYouTube_Later(chat_number, st, fn, delay) {
    var id = Main_setTimeout(function () {
        var pos = st.timers.indexOf(id);
        if (pos !== -1) st.timers.splice(pos, 1);
        if (ChatYouTube_State[chat_number] === st && ChatMulti_IsActive(chat_number, st.seq)) fn();
    }, delay);

    st.timers.push(id);
}

function ChatYouTube_Retry(chat_number, st) {
    // A stream that goes live later has no history: the page of a later load must not be inserted above live lines
    st.withHistory = false;
    ChatYouTube_Later(
        chat_number,
        st,
        function () {
            ChatYouTube_FindLive(chat_number, st);
        },
        ChatYouTube_RetryMs
    );
}

function ChatYouTube_LiveUrl(target) {
    return target.charAt(0) === '@'
        ? 'https://www.youtube.com/@' + encodeURIComponent(target.slice(1)) + '/live'
        : 'https://www.youtube.com/channel/' + encodeURIComponent(target) + '/live';
}

function ChatYouTube_FindLive(chat_number, st) {
    FullxmlHttpGet(ChatYouTube_LiveUrl(st.target), ChatYouTube_Headers, ChatYouTube_LiveResult, noop_fun, chat_number, st.seq);
}

// A live stream needs a live marker, a bare videoId is also on pages of ended or upcoming streams
function ChatYouTube_ParseLive(html) {
    var text = String(html || '');
    if (text.indexOf('"isLiveNow":true') === -1 && text.indexOf('"isLive":true') === -1) return null;

    var match = /"videoId":"([\w-]{11})"/.exec(text);
    return match ? match[1] : null;
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function ChatYouTube_LiveResult(obj, chat_number, seq) {
    var st = ChatYouTube_Current(chat_number, seq),
        videoId = st && obj.status === 200 ? ChatYouTube_ParseLive(obj.responseText) : null;
    if (!st) return;

    if (videoId) ChatYouTube_FetchPage(chat_number, st, videoId);
    else ChatYouTube_Retry(chat_number, st);
}

function ChatYouTube_FetchPage(chat_number, st, videoId) {
    st.videoId = videoId;
    FullxmlHttpGet(ChatYouTube_PageUrl + encodeURIComponent(videoId), ChatYouTube_Headers, ChatYouTube_PageResult, noop_fun, chat_number, st.seq);
}

function ChatYouTube_ParseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

// Parses the JSON object that starts at the first '{' at or after `from` (brace matching, strings aware)
function ChatYouTube_JsonAt(text, from) {
    var start = text.indexOf('{', from),
        depth = 0,
        inString = false,
        i = start,
        c;
    if (start === -1) return null;

    for (i; i < text.length; i++) {
        c = text.charAt(i);

        if (inString) {
            if (c === '\\') i++;
            else if (c === '"') inString = false;
        } else if (c === '"') {
            inString = true;
        } else if (c === '{') {
            depth++;
        } else if (c === '}' && --depth === 0) {
            return ChatYouTube_ParseJson(text.slice(start, i + 1));
        }
    }

    return null;
}

function ChatYouTube_ContinuationOf(list) {
    var data = list && list[0],
        item = data && (data.invalidationContinuationData || data.timedContinuationData || data.reloadContinuationData);

    return item && typeof item.continuation === 'string' && item.continuation ? item.continuation : '';
}

// -> {key, context, continuation, actions} or null when the page is not a usable chat page
function ChatYouTube_ParseChatPage(html) {
    var text = String(html || ''),
        key = /"INNERTUBE_API_KEY":\s*"([\w-]+)"/.exec(text),
        at = text.indexOf('"INNERTUBE_CONTEXT":'),
        context = at === -1 ? null : ChatYouTube_JsonAt(text, at + 20),
        marker = text.indexOf('ytInitialData"] = '),
        data;

    if (marker === -1) marker = text.indexOf('var ytInitialData = ');
    data = marker === -1 ? null : ChatYouTube_JsonAt(text, marker);

    var chat = data && data.contents && data.contents.liveChatRenderer,
        continuation = chat ? ChatYouTube_ContinuationOf(chat.continuations) : '';
    if (!key || !context || !continuation) return null;

    return {
        key: key[1],
        context: context,
        continuation: continuation,
        actions: Object.prototype.toString.call(chat.actions) === '[object Array]' ? chat.actions : []
    };
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function ChatYouTube_PageResult(obj, chat_number, seq) {
    var st = ChatYouTube_Current(chat_number, seq);
    if (!st) return;

    var page = obj.status === 200 ? ChatYouTube_ParseChatPage(obj.responseText) : null;
    if (!page) {
        ChatYouTube_Retry(chat_number, st);
        return;
    }

    st.key = page.key;
    st.context = page.context;
    st.continuation = page.continuation;

    // The first load is history (when wanted), a reload shows only messages newer than the ones already rendered
    ChatYouTube_Render(chat_number, st, page.actions, st.loaded ? 'reload' : st.withHistory ? 'history' : 'skip');
    st.loaded = true;
    st.polled = false;

    ChatYouTube_Poll(chat_number, st);
}

function ChatYouTube_Poll(chat_number, st) {
    FullxmlHttpGet(
        ChatYouTube_PollUrl + encodeURIComponent(st.key),
        ChatYouTube_Headers.concat([['Content-Type', 'application/json']]),
        ChatYouTube_PollResult,
        noop_fun,
        chat_number,
        st.seq,
        'POST',
        JSON.stringify({context: st.context, continuation: st.continuation})
    );
}

// -> {actions, continuation} or null
function ChatYouTube_ParsePoll(text) {
    var json = ChatYouTube_ParseJson(text),
        live = json && json.continuationContents && json.continuationContents.liveChatContinuation;
    if (!live) return null;

    return {
        actions: Object.prototype.toString.call(live.actions) === '[object Array]' ? live.actions : [],
        continuation: ChatYouTube_ContinuationOf(live.continuations)
    };
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function ChatYouTube_PollResult(obj, chat_number, seq) {
    var st = ChatYouTube_Current(chat_number, seq);
    if (!st) return;

    var poll = obj.status === 200 ? ChatYouTube_ParsePoll(obj.responseText) : null;

    if (!poll || !poll.continuation) {
        // Chain broken or stream ended. Reload the chat page only when a poll worked since the last load, else a persistent
        // failure would reload every second: wait for the retry timer (live detection again)
        if (!st.polled) {
            ChatYouTube_Retry(chat_number, st);
            return;
        }

        st.polled = false;
        ChatYouTube_Later(
            chat_number,
            st,
            function () {
                ChatYouTube_FetchPage(chat_number, st, st.videoId);
            },
            ChatYouTube_PollMs
        );
        return;
    }

    st.polled = true;
    st.continuation = poll.continuation;
    // Next poll first: a render exception must not end the session
    ChatYouTube_Later(
        chat_number,
        st,
        function () {
            ChatYouTube_Poll(chat_number, st);
        },
        ChatYouTube_PollMs
    );
    ChatYouTube_Render(chat_number, st, poll.actions, 'live');
}

// Moderation action -> {del: itemId} | {ban: channelId} | null
function ChatYouTube_Moderation(action) {
    var del = action && (action.markChatItemAsDeletedAction || action.removeChatItemAction), // markChatItemAsDeletedAction: shape not yet seen live, removeChatItemAction seen live
        ban = action && action.markChatItemsByAuthorAsDeletedAction; // shape not yet seen live

    if (del && del.targetItemId) return {del: del.targetItemId};
    if (ban && (ban.externalChannelId || ban.authorExternalChannelId)) return {ban: ban.externalChannelId || ban.authorExternalChannelId};
    return null;
}

// mode: 'history' a first page load, deleted items are filtered out; 'skip' a first page load without history, only the
// watermark moves; 'reload' a later page load, only messages newer than the watermark; 'live' a poll. Live: moderation is
// applied at once, messages are sorted by time and spread over the poll interval by their time differences.
// st.lastTs is the newest message time rendered in this session (items without a time, gifts, do not move it).
function ChatYouTube_Render(chat_number, st, actions, mode) {
    var history = mode === 'history',
        mark = st.lastTs,
        seq = st.seq,
        msgs = [],
        mods = [],
        i = 0,
        action,
        msg,
        mod;

    for (i; i < actions.length; i++) {
        action = actions[i];
        mod = ChatYouTube_Moderation(action);

        if (mod) mods.push(mod);
        else if (action && action.addChatItemAction && action.addChatItemAction.item) {
            msg = ChatYouTube_ToMsg(action.addChatItemAction.item, history);
            if (msg) {
                msg.order = msgs.length;
                msgs.push(msg);
            }
        }
    }

    for (i = 0; i < msgs.length; i++) {
        if (msgs[i].realTs && msgs[i].ts > st.lastTs) st.lastTs = msgs[i].ts;
    }

    if (mode === 'skip') return;

    if (mode === 'reload') {
        for (i = msgs.length - 1; i >= 0; i--) {
            if (!msgs[i].realTs || msgs[i].ts <= mark) msgs.splice(i, 1);
        }
    }

    if (history) {
        for (i = 0; i < mods.length; i++) {
            for (var j = msgs.length - 1; j >= 0; j--) {
                if (msgs[j].msgId === mods[i].del || (mods[i].ban && msgs[j].authorId === mods[i].ban)) msgs.splice(j, 1);
            }
        }
        for (i = 0; i < msgs.length; i++) ChatMulti_Line(chat_number, seq, msgs[i]);
        return;
    }

    for (i = 0; i < mods.length; i++) {
        if (mods[i].del) ChatMulti_DeleteMsg('yt', mods[i].del);
        else ChatMulti_DeleteAuthor(chat_number, 'yt', mods[i].ban);
    }

    msgs.sort(function (a, b) {
        return a.ts - b.ts || a.order - b.order;
    });

    for (i = 0; i < msgs.length; i++) ChatYouTube_Spread(chat_number, st, msgs[i], Math.min(msgs[i].ts - msgs[0].ts, ChatYouTube_PollMs));
}

function ChatYouTube_Spread(chat_number, st, msg, delay) {
    if (delay > 0) {
        ChatYouTube_Later(
            chat_number,
            st,
            function () {
                ChatMulti_Line(chat_number, st.seq, msg);
            },
            delay
        );
    } else {
        ChatMulti_Line(chat_number, st.seq, msg);
    }
}

// Protocol relative urls are made absolute, then only whitelisted hosts pass
function ChatYouTube_SafeImage(url) {
    if (typeof url === 'string' && url.indexOf('//') === 0) url = 'https:' + url;
    return ChatMulti_SafeUrl(url, ChatYouTube_ImageHostRegex);
}

function ChatYouTube_LastThumb(thumbnails) {
    var last = thumbnails && thumbnails.length ? thumbnails[thumbnails.length - 1] : null;
    return last ? last.url : null;
}

function ChatYouTube_PushText(tokens, str) {
    var last = tokens.length ? tokens[tokens.length - 1] : null;

    if (!str) return;
    if (typeof last === 'string') tokens[tokens.length - 1] = last + str;
    // Text after an [html] token needs a leading space: extraMessageTokenize overwrites its first word with the previous emote
    else tokens.push(last && str.charAt(0) !== ' ' ? ' ' + str : str);
}

// runs -> tokens for ChatLive_extraMessageTokenize: strings and [html] items. A foreign-host emoji becomes text:
// a unicode emojiId when there is one (custom emoji have an ascii id), else the first shortcut.
function ChatYouTube_Tokens(runs) {
    var tokens = [],
        i = 0,
        len = runs && runs.length ? runs.length : 0,
        run,
        emoji,
        url,
        id;

    for (i; i < len; i++) {
        run = runs[i];

        if (run && typeof run.text === 'string') {
            ChatYouTube_PushText(tokens, run.text);
        } else if (run && run.emoji) {
            emoji = run.emoji;
            url = ChatYouTube_SafeImage(emoji.image && ChatYouTube_LastThumb(emoji.image.thumbnails));
            id = typeof emoji.emojiId === 'string' && !/^[\x00-\x7f]*$/.test(emoji.emojiId) ? emoji.emojiId : '';

            if (url) tokens.push([emoteTemplate(url)]);
            else ChatYouTube_PushText(tokens, id || (emoji.shortcuts && emoji.shortcuts[0]) || '');
        }
    }

    return tokens;
}

// simpleText or runs as plain (unescaped) text
function ChatYouTube_PlainText(obj) {
    if (!obj) return '';
    if (typeof obj.simpleText === 'string') return obj.simpleText;

    var runs = obj.runs || [],
        text = '',
        i = 0;

    for (i; i < runs.length; i++) {
        if (!runs[i]) continue;
        if (typeof runs[i].text === 'string') text += runs[i].text;
        else if (runs[i].emoji) text += (runs[i].emoji.shortcuts && runs[i].emoji.shortcuts[0]) || '';
    }

    return text;
}

// -> {html, role}, role is owner, mod, member or ''
function ChatYouTube_Badges(authorBadges) {
    var html = '',
        role = '',
        i = 0,
        len = authorBadges && authorBadges.length ? authorBadges.length : 0,
        badge,
        icon,
        url;

    for (i; i < len; i++) {
        badge = authorBadges[i] && authorBadges[i].liveChatAuthorBadgeRenderer;
        if (!badge) continue;

        icon = badge.icon && ChatYouTube_Badge_Icons.hasOwnProperty(badge.icon.iconType) ? ChatYouTube_Badge_Icons[badge.icon.iconType] : '';

        if (icon) {
            html += '<span class="tag chat_b_yt_' + icon + '"></span>';
            if (icon === 'owner' || (icon === 'mod' && role !== 'owner')) role = icon;
        } else if (badge.customThumbnail) {
            url = ChatYouTube_SafeImage(ChatYouTube_LastThumb(badge.customThumbnail.thumbnails));

            if (url) {
                html += '<span class="tag" style="background-image: url(' + url + ');"></span>';
                if (!role) role = 'member';
            }
        }
    }

    return {html: html, role: role};
}

// ARGB int -> css rgba() with the alpha capped at 0.4 (light tiers are opaque and unreadable under white text), null when it is not a number
function ChatYouTube_Color(argb) {
    var n = Number(argb);
    if (!isFinite(n) || n < 0 || n > 4294967295) return null;

    return 'rgba(' + ((n >>> 16) & 255) + ',' + ((n >>> 8) & 255) + ',' + (n & 255) + ',' + Math.min((n >>> 24) / 255, 0.4).toFixed(2) + ')';
}

function ChatYouTube_Ts(timestampUsec) {
    var ts = Math.floor(Number(timestampUsec) / 1000);
    return ts > 0 ? ts : new Date().getTime();
}

function ChatYouTube_Msg(renderer, history, nick, tokens, text, badges) {
    return {
        platform: 'yt',
        msgId: renderer.id,
        authorId: renderer.authorExternalChannelId,
        nick: nick.replace(/^@/, ''), // YouTube names are handles (@name), the @ is noise in the chat
        color: null,
        role: badges.role,
        badges: badges.html,
        tokens: tokens,
        text: text,
        ts: ChatYouTube_Ts(renderer.timestampUsec),
        realTs: Number(renderer.timestampUsec) > 0,
        history: !!history,
        special: null,
        highlight: null
    };
}

// A special line shows the nick itself when the message body (which carries the nick) is empty
function ChatYouTube_Special(msg, nick, label) {
    msg.special = (msg.tokens.length ? '' : Screens_AriaEscape(nick) + ' ') + label;
    return msg;
}

// -> msg for ChatMulti_Line or null for items that are not shown
function ChatYouTube_ToMsg(item, history) {
    if (!item) return null;

    var renderer = item.liveChatTextMessageRenderer,
        nick,
        msg,
        badges,
        runs,
        text;

    if (renderer) {
        runs = renderer.message && renderer.message.runs;
        return ChatYouTube_Msg(
            renderer,
            history,
            ChatYouTube_PlainText(renderer.authorName),
            ChatYouTube_Tokens(runs),
            ChatYouTube_PlainText(renderer.message),
            ChatYouTube_Badges(renderer.authorBadges)
        );
    }

    // The items below were not seen live yet except giftMessageViewModel, shapes follow spec 6.3 point 4
    renderer = item.liveChatPaidMessageRenderer; // shape not yet seen live
    if (renderer) {
        msg = ChatYouTube_Msg(
            renderer,
            history,
            ChatYouTube_PlainText(renderer.authorName),
            ChatYouTube_Tokens(renderer.message && renderer.message.runs),
            ChatYouTube_PlainText(renderer.message),
            ChatYouTube_Badges(renderer.authorBadges)
        );
        msg.highlight = ChatYouTube_Color(renderer.bodyBackgroundColor);
        return ChatYouTube_Special(
            msg,
            msg.nick,
            Screens_AriaEscape(STR_CHAT_YT_SUPERCHAT + ' ' + ChatYouTube_PlainText(renderer.purchaseAmountText))
        );
    }

    renderer = item.liveChatPaidStickerRenderer; // shape not yet seen live
    if (renderer) {
        msg = ChatYouTube_Msg(renderer, history, ChatYouTube_PlainText(renderer.authorName), [], '', ChatYouTube_Badges(renderer.authorBadges));
        msg.highlight = ChatYouTube_Color(renderer.moneyChipBackgroundColor || renderer.backgroundColor);
        text = ChatYouTube_SafeImage(renderer.sticker && ChatYouTube_LastThumb(renderer.sticker.thumbnails));
        return ChatYouTube_Special(
            msg,
            msg.nick,
            Screens_AriaEscape(STR_CHAT_YT_SUPERSTICKER + ' ' + ChatYouTube_PlainText(renderer.purchaseAmountText)) +
                (text ? ' ' + emoteTemplate(text) : '')
        );
    }

    renderer = item.liveChatMembershipItemRenderer; // shape not yet seen live
    if (renderer) {
        msg = ChatYouTube_Msg(
            renderer,
            history,
            ChatYouTube_PlainText(renderer.authorName),
            ChatYouTube_Tokens(renderer.message && renderer.message.runs),
            ChatYouTube_PlainText(renderer.message),
            ChatYouTube_Badges(renderer.authorBadges)
        );
        text = (ChatYouTube_PlainText(renderer.headerPrimaryText) + ' ' + ChatYouTube_PlainText(renderer.headerSubtext)).replace(/^\s+|\s+$/g, '');
        return ChatYouTube_Special(msg, msg.nick, Screens_AriaEscape(text || STR_CHAT_YT_MEMBERSHIP));
    }

    renderer = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer; // shape not yet seen live
    if (renderer) {
        badges = renderer.header && renderer.header.liveChatSponsorshipsHeaderRenderer;
        if (!badges) return null;

        nick = ChatYouTube_PlainText(badges.authorName);
        msg = ChatYouTube_Msg(renderer, history, nick, [], '', ChatYouTube_Badges(badges.authorBadges));
        return ChatYouTube_Special(msg, msg.nick, Screens_AriaEscape(ChatYouTube_PlainText(badges.primaryText) || STR_CHAT_YT_GIFT));
    }

    renderer = item.liveChatSponsorshipsGiftRedemptionAnnouncementRenderer; // shape not yet seen live
    if (renderer) {
        nick = ChatYouTube_PlainText(renderer.authorName);
        msg = ChatYouTube_Msg(renderer, history, nick, [], '', ChatYouTube_Badges(renderer.authorBadges));
        return ChatYouTube_Special(msg, msg.nick, Screens_AriaEscape(ChatYouTube_PlainText(renderer.message) || STR_CHAT_YT_MEMBERSHIP));
    }

    // Gift (seen live): a view model without time or channel id, shown only with an author and a readable text
    renderer = item.giftMessageViewModel;
    if (renderer) {
        nick = ((renderer.authorName && renderer.authorName.content) || '').replace(/^\s+|\s+$/g, '');
        text = ((renderer.text && renderer.text.content) || '').replace(/^\s+|\s+$/g, '');
        if (!nick || !text) return null;

        msg = ChatYouTube_Msg(renderer, history, nick, [], '', {html: '', role: ''});
        msg.special = Screens_AriaEscape(msg.nick + ' ' + text);
        return msg;
    }

    return null;
}
