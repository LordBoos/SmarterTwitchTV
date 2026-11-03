# Smarter Purple TV

A Twitch and Kick client for Android TV. This is a fork of [SmartTwitchTV](https://github.com/fgl27/SmartTwitchTV) by Felipe de Leon – same app you know, slowly getting a mind of its own.

Same two-part architecture as upstream – a web app (UI and most features) loaded by an Android APK (players and platform glue) – same features, same remote-friendly navigation. The differences are listed below.

## What's different from SmartTwitchTV

- **Kick as a second platform.** Kick streams play like Twitch ones: live streams, VODs and clips, channel pages, history, quality choice and low latency.
  - Kick accounts: add a Kick account on its own or link it to a Twitch user by scanning a QR code with the Kick app (Users → Add Kick User), no password typed on the TV,
  - Following lists live Twitch and Kick channels together, told apart by platform icons, also in the player and side panels,
  - Live, Games and Search have a Twitch / Kick switch, and Kick channels can be followed and unfollowed,
  - on a Kick stream the Kick chat with its history is the main chat, the streamer's Twitch and YouTube chats can be linked to it, and you can write in it once signed in to Kick,
  - 50/50, picture-in-picture and 4-way multistream take any mix of Twitch and Kick streams,
  - not available for Kick: video search, chat replay of Kick videos and the phone chat.

  Design notes: [docs/kick-design.md](docs/kick-design.md).
- **4-way multistream on TVs with only two hardware video decoders.** Two of the four streams are decoded in software, at 480p by default (Settings → Player → 4-way multistream with software decoding, also 720p or off). The option shows up only on TVs that need it. Requires APK 3.0.396.
- **Ad blocking, no proxy needed.** Ads stitched into live streams are removed directly from the playback playlists, using only Twitch's own servers. Ad breaks that can no longer be hidden freeze the picture on the last live frame until the break is over, and a pre-playback probe checks every stream quality so stitched ads can't slip into playback. On by default, can be turned off in Settings → Player → Block ads. (Requires an APK built from this fork.)
- **Follow raids.** When the watched streamer raids, the player switches to the raided channel automatically (optional, requires login).
- **A new default look.** Purple accent throughout: focused items get a purple outline and glow, the Following hearts are purple, and so are the loading spinners. Same dark base, own identity.
- **YouTube and Kick chat merged into the Twitch chat.** For streamers who multistream, their YouTube and Kick messages show up in the player chat next to Twitch, read-only, in both the main and the picture-in-picture / 50-50 chat:
  - a platform icon on every line, platform badges (owner, moderator, member / subscriber, VIP and more) and the users' own nick colors, all following "Readable nick colors",
  - YouTube Super Chats, Super Stickers and memberships, Kick subscriptions and gifted subscriptions, shown like Twitch sub notices,
  - Twitch, YouTube and Kick emotes, plus the channel's 7TV, BTTV and FFZ emotes on every platform,
  - recent history from all platforms when a stream opens, sorted by send time, and deleted messages and bans applied like on Twitch.

  The YouTube and Kick channels of a streamer come from the [UnityChat](https://jouki.cz/UnityChat) directory. The **Linked chats** button in the player chat controls shows them and lets you enter your own channel, unlink a platform or turn linking off per streamer. Turn the whole feature off in Settings → Chat → YouTube and Kick chat. Design notes: [docs/unitychat-design.md](docs/unitychat-design.md).

**Chat on phone:** APK 386 can host the phone chat page on your local network. Scan the TV QR, sign in on your phone, and chat follows the live stream playing on TV. See [setup and build instructions](docs/phone-chat-setup.md); Twitch login requires an owner-controlled client ID.

## Install and updates

Download the APK from [Releases](https://github.com/LordBoos/SmarterTwitchTV/releases). The app loads its web part from this repository's GitHub Pages, so web fixes reach the TV on the next app start without a new APK. APK releases are built, signed and published by the `Release APK` GitHub Actions workflow when the APK version changes.

This fork's APK is signed with its own key, so it can't update an installed build of upstream SmartTwitchTV or another fork: uninstall that app first (its local settings and login are removed).

## Everything else

Build instructions, translations, troubleshooting and the full story of the app live in the [upstream README](https://github.com/fgl27/SmartTwitchTV#readme). To build this fork, follow the same steps against this repository.

## Credits and license

SmartTwitchTV is © 2017–present Felipe de Leon, its contributors, and this fork's contributors. Licensed under the [GPL-3.0](LICENSE), as is everything derived from it.
