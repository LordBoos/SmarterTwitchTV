/*
 * Channel links for merged chat: which YouTube / Kick channel belongs to a Twitch streamer.
 * Source is the UnityChat directory, overridable per streamer by manual values.
 */

//Variable initialization
var ChatLink_StoreKey = 'chat_links';
var ChatLink_DirCache = {}; // {login: streamer|null}, only successful answers (200 / 404) are cached
var ChatLink_LookupUrl = 'https://api.jouki.cz/streamers/lookup?platform=twitch&handle=';
//Variable initialization end

function ChatLink_Get(login) {
    var entry = Main_getItemJson(ChatLink_StoreKey, {})[login];
    return entry && typeof entry === 'object' ? entry : {enabled: true};
}

function ChatLink_Save(login, entry) {
    var all = Main_getItemJson(ChatLink_StoreKey, {});
    all[login] = entry;
    Main_setItem(ChatLink_StoreKey, JSON.stringify(all));
}

// Returns '@handle' (lowercase) or 'UC...' (24 chars), null if the input is not usable
function ChatLink_NormalizeYouTube(input) {
    var text = String(input || '').replace(/^\s+|\s+$/g, '');
    var match;

    if (/^UC[\w-]{22}$/.test(text)) return text;

    if (/youtube\.com\//i.test(text)) {
        match = text.match(/\/channel\/(UC[\w-]{22})(?:[/?#]|$)/i);
        if (match) return match[1];

        match = text.match(/\/@([\w.-]{3,30})(?:[/?#]|$)/);
        return match ? '@' + match[1].toLowerCase() : null;
    }

    match = text.match(/^@?([\w.-]{3,30})$/);
    return match ? '@' + match[1].toLowerCase() : null;
}

// Returns a lowercase kick.com slug, null if the input is not usable
function ChatLink_NormalizeKick(input) {
    var match = String(input || '')
        .replace(/^\s+|\s+$/g, '')
        .match(/^(?:https?:\/\/)?(?:www\.)?(?:kick\.com\/)?([\w-]{1,25})\/?$/i);
    return match ? match[1].toLowerCase() : null;
}

// entry: stored entry, dir: directory streamer or null. Missing platform = directory, '' = do not link, else manual.
function ChatLink_Resolve(entry, dir) {
    var result = {yt: null, kick: null};
    if (!entry || entry.enabled === false) return result;

    if (typeof entry.yt === 'string') {
        if (entry.yt) {
            var yt = ChatLink_NormalizeYouTube(entry.yt);
            if (yt) result.yt = {value: yt, source: 'manual'};
        }
    } else if (dir) {
        var fromDir = ChatLink_NormalizeYouTube(dir.youtubeChannelId) || ChatLink_NormalizeYouTube(dir.youtubeHandle);
        if (fromDir) result.yt = {value: fromDir, source: 'dir'};
    }

    if (typeof entry.kick === 'string') {
        if (entry.kick) {
            var kick = ChatLink_NormalizeKick(entry.kick);
            if (kick) result.kick = {value: kick, source: 'manual'};
        }
    } else if (dir) {
        var kickDir = ChatLink_NormalizeKick(dir.kickSlug);
        if (kickDir) result.kick = {value: kickDir, source: 'dir'};
    }

    return result;
}

function ChatLink_Lookup(chat_number, id) {
    var login = ChatLive_selectedChannel[chat_number];

    if (login in ChatLink_DirCache) {
        ChatMulti_OnLinks(chat_number, id);
        return;
    }

    FullxmlHttpGet(ChatLink_LookupUrl + encodeURIComponent(login), null, ChatLink_LookupResult, noop_fun, chat_number, id);
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function ChatLink_LookupResult(obj, chat_number, id) {
    if (id !== Chat_Id[chat_number]) return;

    var login = ChatLive_selectedChannel[chat_number];
    var json;

    if (obj.status === 200) {
        try {
            json = JSON.parse(obj.responseText);
        } catch (e) {
            json = null;
        }
        // Invalid JSON is handled like a network error: not cached
        if (json) ChatLink_DirCache[login] = json.found && json.streamer ? json.streamer : null;
    } else if (obj.status === 404) {
        ChatLink_DirCache[login] = null;
    }

    // Directory failures are silent, manual links still work
    ChatMulti_OnLinks(chat_number, id);
}

function ChatLink_Current(chat_number) {
    var login = ChatLive_selectedChannel[chat_number];
    return ChatLink_Resolve(ChatLink_Get(login), ChatLink_DirCache[login] || null);
}
