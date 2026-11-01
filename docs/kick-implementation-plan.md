# Kick jako druhá platforma – implementační plán

> **Pro agentní implementaci:** POVINNÝ SUB-SKILL: superpowers:subagent-driven-development (doporučeno) nebo superpowers:executing-plans. Plní se po úlohách v pořadí, každá úloha je samostatně testovatelná a končí commitem. Kroky mají zaškrtávací syntaxi (`- [ ]`).

**Cíl:** Kick jako rovnocenná druhá platforma vedle Twitche: přehrávání Kick živých streamů, VOD a klipů (i ve 50/50, PiP a čtyřech streamech, i v kombinaci s Twitchem), Kick hlavní chat s připojitelným Twitchem a YouTube, Kick účty přes QR (samostatné i připojené k Twitch uživateli), sloučený Following, procházení a vyhledávání Kicku, sledování a psaní do Kick chatu. Twitch chování se pro uživatele bez Kicku nemění.

**Architektura:**
- Kick řádky používají stávající datová pole karet (`ScreensObj_LiveCellArray` a spol.) plus pozici `[19] = 'kick'`. Stávající kód karet, přehrávače, historie a navigace s nimi pracuje beze změny.
- `app/specific/KickApi.js`: hlavičky, ID helpery a převod odpovědí Kicku na řádky. `app/specific/KickUser.js`: QR přihlášení, Kick údaje u uživatele, sloučení Following.
- `PlayHLS_GetPlayListAsync` / `Sync` poznají Kick podle prefixu `kick:` v ID a vrátí stejný tvar výsledku jako Twitch (`{status, url, responseText, checkResult}`).
- Helix volání s Kick ID zastaví jedna pojistka v `BaseXmlHttpGet` / `FullxmlHttpGet`. Chyba jde stávající chybovou cestou.
- Kick hlavní chat = existující `ChatKick`. Twitch se do Kick chatu připojí stávající IRC cestou (anonymně), YouTube přes `ChatYouTube`.

**Tech stack:** vanilla ES5 (staré TV WebView), JSHint, Node harness ve `vm` sandboxu (vzor `release/scripts/chat-multi-tests.js`), adb + Chrome DevTools Protocol na TV. Java ani APK se nemění.

**Spec:** `docs/kick-design.md` (rozhodnutí 1–15, fakta o API v oddílu 4, mapa kódu v oddílu 5, akceptace v oddílu 7). Kdo plní úlohu, čte plán i spec. Výsledky, odchylky a zaparkované body zapisuje průběžně do `docs/kick-implementation-results.md` (vytvoří úloha 1).

## Global Constraints

- **ES5:** bez arrow funkcí, `let/const`, `class`, template literals, `fetch`, `Array.prototype.includes`, `Object.assign`. Musí projít `node release/scripts/maker.js jsh`.
- **Prettier** podle `.prettierrc`: 4 mezery, šířka 150, jednoduché uvozovky, bez trailing comma. Komentáře v kódu anglicky.
- **`FullxmlHttpGet`:** callbacky jen pojmenované top-level funkce (volají se přes `fn.name` a `eval`). Pro GET se předává `null, null` (Method, postMessage). Callback dostane `(obj, key, checkResult)`, `obj = {status, responseText}`, síťová chyba = `status: 0`. Chybový callback se nevolá. Při ladění přes CDP se callback nikdy neobaluje anonymní funkcí.
- **Kick požadavky** jdou přes `KickApi_Headers(token)`: desktopový User-Agent `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36` a `Accept: application/json`. `Authorization: Bearer <token>` jen s Kick tokenem a jen na hosty `*.kick.com`.
  - Twitch token nikdy nejde na Kick, Kick token nikdy na jiný host.
  - Přihlášená volání nativně přes `FullxmlHttpGet` (Kick WAF blokuje Node `fetch`, proto curl).
- **Generace:** každá asynchronní odpověď ověří, že patří k aktuálnímu stavu, a stará se zahodí.
  - Obrazovky: `ScreenObj[key].navigationRequest.id` a `Navigation_Account()`.
  - Panel přehrávače: `Navigation_FeedFull` tickety.
  - Přehrávač: `Play_loadDataId` a další `checkResult`.
  - Chat: `ChatMulti_IsActive`.
  - QR: `KickLogin_Session.seq`.
- **Nedůvěryhodná data z Kicku** (jména, titulky, kategorie, bio, URL):
  - Text do řádků jen přes `Screens_AriaEscape`, titulky navíc přes `twemoji.parse`.
  - URL obrázků jen přes `KickApi_Img`: query se odřízne, pak `ChatMulti_SafeUrl` s hosty `images.kick.com|files.kick.com|clips.kick.com|stream.kick.com`, jinak `''`.
  - URL playlistů jen `https://` na `*.kick.com` nebo `*.live-video.net`.
  - Slug jen `/^[\w-]{1,40}$/`.
- **Tiché selhání:** výpadek Kicku nebo adresáře nezobrazí chybový dialog, Twitch část obrazovky a přehrávání se nezmění. Výjimka: 401 s Kick tokenem → `KickUser_Expired()`, jedno upozornění za běh aplikace.
- **Texty:** nikde em dash (U+2014), jen en dash `–`. Nové řetězce do `app/languages/0_Strings.js` (deklarace) a `app/languages/en_US.js` (hodnota). Na konec `app/languages/untranslated/untranslated_ui_js.txt` jeden řádek „Added in en_US (2026-11-01): STR_…, … (Kick as a second platform). Translate these in es_ES, fr_FR, pt_BR, ru_RU, tr_TR, uk_UA.“, další úlohy ho doplňují.
- **Commity:** anglicky, bez řádků `Co-Authored-By` a `Claude-Session`, jen na `feature/kick`. Žádný push, release, merge, zvýšení verzí ani commit vygenerovaného `release/`. `release/` se ručně needituje.
- **Nové soubory** `app/specific/KickApi.js` a `KickUser.js` přidat do bloku `jsstart … jsend` v `app/index.html` za `specific/ChatLinkDialog.js` (:5435). Ladicí APK načítá `index.html` z assets, bez tagu se soubor na TV nenačte.
- **Harnessy po každé úloze zelené**, včetně nového `release/scripts/kick-tests.js`:

```bash
node release/scripts/maker.js jsh
for t in chat-multi chat-optimization player-ui grid-window navigation raid remote-input search-navigation ui-focus update following phonechat-collector phonechat kick; do node release/scripts/$t-tests.js || exit 1; done
```

  - Výchozí stav (1. 11.): všech 13 stávajících zelených.
  - Nové volání do jiného souboru z funkce, kterou spouští stávající harness, shodí harness s `ReferenceError`. Patří sem `ChatLive_Init` (chat-optimization), `PlayRaid_SetChannel` (raid), `Screens_loadDataRequest` (following), funkce z `PlayEtc.js` (player-ui, phonechat).
  - Řešení: stub vedle ostatních, např. `s.KickApi_IsKickId = id => /^kick:/.test(String(id));`, nebo nové volání až za kontrolou vlastnosti, kterou testovací objekt nemá.
- **Twitch beze změny pro Twitch-only uživatele:** bez Kick tokenu žádný požadavek na `kick.com` (kromě Kick obrazovek, které si uživatel otevře), na Twitch kartách žádné nové ikonky a stejné pořadí Following.
- **Harness `release/scripts/kick-tests.js`** ve stylu `chat-multi-tests.js`:
  - Fixtury načítá `ref = n => JSON.parse(fs.readFileSync('jsonreferences/' + n, 'utf8'))`.
  - Funkce z velkých souborů (`Main.js`, `Screens.js`, `ScreensObj.js`) vytahuje přes UglifyJS walker jako `following-tests.js`. Malé soubory (`ChatMulti.js`, `KickApi.js`, `KickUser.js`, `PlayHLS.js`) načítá celé.
  - Končí `console.log(checks + ' kick checks passed')`.
- **Fixtury** (`jsonreferences/kick_*.json`) se stahují curl s desktopovým UA. Token se čte jen za běhu:

```bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
AUTH="Authorization: Bearer $(node -p "require(require('os').homedir()+'/.claude/state/kick-tvlink-token.json').token")"
```

  - Token se nikam nezapisuje (ani do fixtur, scratchpadu, logu nebo výpisu).
  - Před commitem: `?token=…` v URL → `?token=REDACTED`, smazat `email` a jiné údaje uživatele, pole zkrátit na 5 položek, formátovat přes `JSON.stringify(x, null, 1)`.
  - Kontrola: `grep -lE 'eyJ|"email"|Bearer' jsonreferences/kick_*.json` nic nenajde.
- **Ověření na TV** (Sony BRAVIA, debug `com.fgl27.twitch.debug`, `adb connect <IP TV>:5555`):
  - Před první prací se zařízením si poznamenej `adb -s <IP TV>:5555 shell settings get secure sleep_timeout` a `… get system screen_off_timeout` (původně `1800000` a `600000`).
  - Na noc nastav `… put secure sleep_timeout 0` a `… put system screen_off_timeout 2147483647`. Úloha 14 je vrátí.

```bash
bash release/scripts/up_assets.sh && (cd apk && ./gradlew.bat assembleDebug) && adb -s <IP TV>:5555 install -r apk/app/build/outputs/apk/debug/app-debug.apk && bash release/scripts/up_assets.sh 1 && git checkout -- apk/app/src/main/java/com/fgl27/twitch/Constants.java
adb -s <IP TV>:5555 shell am start -n com.fgl27.twitch.debug/com.fgl27.twitch.PlayerActivity
PID=$(adb -s <IP TV>:5555 shell pidof com.fgl27.twitch.debug | tr -d '\r')
adb -s <IP TV>:5555 forward tcp:9222 localabstract:webview_devtools_remote_$PID
node <scratchpad>/cdp.js <scratchpad>/expr.js     # evaluates expr.js in the app WebView, prints the result
adb -s <IP TV>:5555 shell input keyevent 23   # OK; 19/20/21/22 arrows, 4 back
adb -s <IP TV>:5555 exec-out screencap -p > <scratchpad>/shot.png   # look at it with Read
```

  - `cdp.js` je vzor v `<scratchpad>\probe\cdp.js`. Když chybí, má 8 řádků: `fetch('http://localhost:9222/json')` → stránka s `index.html` → `WebSocket(webSocketDebuggerUrl)` → `Runtime.evaluate {expression, awaitPromise: true, returnByValue: true}` → vypsat `result.value` nebo `exceptionDetails`. Node 22 má globální `WebSocket`.
  - **Kick token do debug aplikace** (od úlohy 7) jen skriptem `kick-token.js` ve scratchpadu. Skript načte token z `~/.claude/state/kick-tvlink-token.json`, sestaví výraz `KickLogin_Accept(<token>, {link: <pos>})` v paměti a pošle ho stejně jako `cdp.js`. Token nevypisuje a neukládá.
  - **Živé Kick kanály** se vybírají v době testu:

```bash
curl -s -A "$UA" 'https://mobile.kick.com/api/v1/livestreams?limit=5&sort=viewer_count_desc'   # data.livestreams[].channel.slug
curl -s -A "$UA" -H "$AUTH" https://kick.com/api/v1/user/livestreams                        # followed and live
```

  - Na zařízení se testuje po každé úloze, která mění chování. Co nejde ověřit, se zapíše do výsledků (nezastavuje to další úlohy).
  - Neřešitelná překážka (Kick změnil API, chybí živý kanál) se zaparkuje s přesným popisem (status, začátek odpovědi) a pokračuje se další úlohou.

## Review Focus

1. **XSS přes data Kicku.** Jméno `"><img src=x onerror=1>`, titulek `<script>x</script>`, obrázek z `https://evil.example/a.png` nebo s `'` v URL, slug s mezerou. Očekávání: v HTML karty, panelu, bočního panelu, stránky kanálu ani přehrávače není nový tag ani atribut, cizí URL se zahodí. Testy: úloha 1 (řádky), úloha 4 (stránka kanálu).
2. **Kick ID unikne do Twitch API.** Helix `?user_id=kick:xqc` se nesmí odeslat. Worker historie nesmí smazat Kick živé položky. Dávka blokovaných kanálů nesmí obsahovat `kick:`. Raid EventSub se pro Kick nespustí. Twitch IRC se pro Kick řádek nepřipojí k Twitch kanálu se stejným loginem. Twitch token nesmí jít na `kick.com`. Testy: úloha 2.
3. **Relativní playlisty.** Kick VOD master má varianty `1080p60/playlist.m3u8`, klip je media playlist se segmenty `521.ts`. Java `Tools.ResponseObj.url` je vždy `null`, takže Kick větev musí do výsledku vložit skutečnou URL masteru, jinak přehrávač variantu nenajde. Testy: úloha 2 (`url` ve výsledku), úloha 5 (klip `StartAuto` typ 2 s textem playlistu).
4. **Zastaralé asynchronní výsledky.** Kick část Following dorazí po přepnutí uživatele nebo obnovení obrazovky. QR přihlášení skončí po zavření dialogu. Odpověď kanálu patří streamu, který už neběží. Očekávání: výsledek se zahodí, nic se nepřipíše ke špatnému uživateli. Testy: úloha 7 (QR), úloha 8 (Following).
5. **Regrese pro Twitch-only uživatele.** Bez Kick tokenu se Following nepošle na `kick.com`, pořadí karet je stejné a Twitch karty nemají ikonku. Stávajících 13 harnessů je zelených. Testy: úloha 8 (žádný požadavek, stejné pořadí), úloha 1 (`KickApi_CardIcon` pro Twitch řádek `''`).

---

### Task 1: Kick API modul, řádky karet, ikonka platformy a fixtury

Výsledkem jsou převodníky odpovědí Kicku na řádky, ikonka Kicku na kartách (zatím bez zdroje Kick dat), harness a fixtury. Twitch chování se nemění.

**Soubory:**
- Vytvořit: `app/specific/KickApi.js`, `release/scripts/kick-tests.js`, `docs/kick-implementation-results.md` (nadpis a tabulka úloha / stav / poznámka). Fixtury `jsonreferences/kick_user_livestreams.json` (s tokenem), `kick_followed.json` (s tokenem), `kick_videos.json`, `kick_clips.json` (oba `xqc` nebo jiný kanál s VOD) a `kick_video.json` (`/api/v1/video/<uuid>`).
- Upravit:
  - `app/index.html`: script tag (:5435) a CSS u `.chat_pi_kick` (:2660).
  - `app/specific/Screens.js`: `Screens_createCellLive` :992 (před jméno za ikonu živého vysílání), `Screens_createCellVod` :911 (před `valuesArray[1]`), `Screens_createCellClip` :838 (před jméno), `Screens_createCellChannel` :762 (před jméno).
  - `app/specific/UserLiveFeedobj.js`: `UserLiveFeedobj_CreatFeed` :1030 a `UserLiveFeedobj_CreateSideFeed` :971 (před `data[1]`).

**Rozhraní:**
- Používá: `ChatMulti_SafeUrl` (`ChatMulti.js`), `Screens_AriaEscape`, `twemoji.parse`, `Main_formatNumber`, `Main_videoCreatedAt`, `Play_streamLiveAt`.
- Poskytuje (`KickApi.js`):
  - `KickApi_Base = 'https://kick.com/api/'`, `KickApi_UA` (viz Global Constraints), `KickApi_ImgHosts = /^(images\.kick\.com|files\.kick\.com|clips\.kick\.com|stream\.kick\.com)$/`.
  - `KickApi_Headers(token) -> [['User-Agent', UA], ['Accept', 'application/json']]`, s tokenem navíc `['Authorization', 'Bearer ' + token]`.
  - `KickApi_Id(slug) -> 'kick:' + slug.toLowerCase()`, `KickApi_IsKickId(id) -> /^kick:/.test(String(id))`, `KickApi_Slug(id) -> String(id).slice(5)`, `KickApi_IsKickRow(data) -> !!data && data[19] === 'kick'`.
  - `KickApi_Iso(str) -> string`: `'2026-10-31 22:33:21'` → `'2026-10-31T22:33:21Z'`. Řetězec s `T` nechá a doplní `Z` jen bez časové zóny. Nesmyslný vstup vrátí `''`.
  - `KickApi_Img(url) -> string`: odříznutá query, pak `ChatMulti_SafeUrl(url, KickApi_ImgHosts) || ''`.
  - `KickApi_Lang(value) -> 'xx' | ''`: jen dvoupísmenný kód (`lang_iso` nebo `language`), malými písmeny.
  - `KickApi_LiveCell(ls, ch) -> Array(20)`: `ch` je volitelné `{slug, username, avatar}`. Bez `ch` se bere z `ls.channel` (`slug`, `user.username || username`, `user.profilepic || profile_pic`). Podporuje tvary `v1/user/livestreams`, `mobile.kick.com/api/v1/livestreams` a `v2/channels.livestream`.
  - `KickApi_ChannelLiveCell(json) -> Array(20) | null` (null bez `livestream`).
  - `KickApi_VodCell(v, ch) -> Array(20)`, `ch = {slug, name}`.
  - `KickApi_ClipCell(c) -> Array(20)`.
  - `KickApi_ChannelCell(f) -> Array(20)` (`f` = položka `v2/channels/followed`).
  - `KickApi_Item(cell, id, channelId, isMature) -> {kickCell, id, user_id: channelId, broadcaster_id: channelId, game_id: null, is_mature}` (obal pro `ScreenObj.data`).
  - `KickApi_CardIcon(data) -> '<span class="tag chat_pi_kick card_pi"></span>' | ''`.
- Pozice řádků (indexy jako Twitch, `[19] = 'kick'` všude):
  - **Živý stream:**
    - `[0]` `KickApi_Img(thumbnail.src)` (může být `''`, `v2/channels` vrací u živého `thumbnail: null`),
    - `[1]` jméno escapované, `[2]` titulek escapovaný (`session_title || title`), `[3]` kategorie escapovaná (`categories[0].name || category.name`),
    - `[4]` `Main_formatNumber(viewer_count)`, `[5]` `'[XX]'` nebo `''`, `[6]` slug kanálu,
    - `[7]` `'kick:' + ls.id`, `[8]` `false`, `[9]` `KickApi_Img(avatar)`, `[10]` `false`,
    - `[11]` `Play_streamLiveAt(iso)`, `[12]` iso začátku, `[13]` číslo diváků, `[14]` `KickApi_Id(slug)`, `[15]` kód jazyka, `[16]`–`[18]` `null`.
  - **VOD** (`v2/channels/<slug>/videos`):
    - `[0]` náhled, `[1]` `ch.name` escapované, `[2]` `Main_videoCreatedAt(iso start_time)`, `[3]` kategorie, `[4]` `Main_formatNumber(views)`,
    - `[5]` `'[XX]'`, `[6]` slug, `[7]` `'kick:' + video.uuid`, `[8]` `null`, `[9]` jazyk,
    - `[10]` `twemoji.parse(escape(session_title))`, `[11]` `Math.round(duration / 1000)`, `[12]` iso, `[13]` views, `[14]` `KickApi_Id(slug)`, `[15]` jako `[11]`, `[16]` `null`.
  - **Klip:**
    - `[0]` `clip_url` (jen `https://clips.kick.com/...`, jinak `''`), `[1]` `duration`, `[2]` `KickApi_Id(channel.slug)`, `[3]` `category.name`, `[4]` `channel.username`, `[5]` `KickApi_Img(channel.profile_picture)`,
    - `[6]` slug, `[7]` `'kick:' + id`, `[8]` `null` (bez VOD → `PlayClip_HasVOD` false), `[9]` `null`, `[10]` titulek,
    - `[11]` `''`, `[12]` iso `created_at`, `[13]` views, `[14]` `Main_formatNumber(views)`, `[15]` `KickApi_Img(thumbnail_url)`, `[16]` `Main_videoCreatedAt(iso)`, `[17]` `''`, `[18]` `null`.
  - **Kanál:** `[slug, KickApi_Id(slug), KickApi_Img(profile_picture), escape(user_username), false, null]`, `[19] = 'kick'`.
- **Decision:** `[14]` je `'kick:' + slug`, ne `'kick:' + id kanálu`. `v2/channels/followed` ID kanálu nevrací (ověřeno), slug je dostupný ve všech odpovědích a nekoliduje s Twitch ID.
- **Decision:** i `[7]` má prefix `kick:`, protože historie sdílí pole s Twitchem a třídí se podle `id`.

- [ ] **Krok 1: Fixtury.** Stáhni curl podle Global Constraints a vyčisti:
  - `https://kick.com/api/v1/user/livestreams` (AUTH) → `kick_user_livestreams.json` (pole),
  - `https://kick.com/api/v2/channels/followed` (AUTH) → `kick_followed.json`,
  - `https://kick.com/api/v2/channels/xqc/videos` → `kick_videos.json`,
  - `https://kick.com/api/v2/channels/xqc/clips` → `kick_clips.json`,
  - `https://kick.com/api/v1/video/<uuid prvního ukončeného videa>` → `kick_video.json`.

  Když nikdo sledovaný nevysílá, ulož prázdné pole a do testů vlož ručně složenou položku podle tvaru ze specu 4.2 (komentář `// shape from spec 4.2, nothing followed was live`).
- [ ] **Krok 2: Padající testy** v `kick-tests.js`:
  - Sandbox načte `thirdparty/twemoji.js`, `ChatMulti.js`, `KickApi.js` a výřez `Screens_AriaEscape`.
  - Stuby: `Main_formatNumber: n => 'F' + n`, `Main_videoCreatedAt: t => 'D' + t`, `Play_streamLiveAt: t => 'S' + t`.

```js
const live = ref('kick_user_livestreams.json')[0];
let c = s.KickApi_LiveCell(live);
check(c.length === 20 && c[19] === 'kick', 'live row: 20 slots, platform in 19');
check(c[6] === live.channel.slug && c[14] === 'kick:' + live.channel.slug.toLowerCase() && c[7] === 'kick:' + live.id, 'slug in 6, prefixed ids in 7 and 14');
check(c[13] === live.viewer_count && c[4] === 'F' + live.viewer_count && c[0] === live.thumbnail.src.split('?')[0], 'viewers and thumbnail without query');
const browse = {id: '01a19458-57a0-7e14-a3c5-0494d215f8de', title: 'T', viewer_count: 5, start_time: '2026-10-31T23:43:00Z', language: 'pt', is_mature: false,
    thumbnail: {src: 'https://images.kick.com/video_thumbnails/a/b/720.webp'}, category: {name: 'IRL'},
    channel: {id: 1, slug: 'jucacaoepitcao', username: 'JucacaoePitcao', profile_pic: 'https://files.kick.com/x.webp'}};
c = s.KickApi_LiveCell(browse);
check(c[1] === 'JucacaoePitcao' && c[2] === 'T' && c[3] === 'IRL' && c[5] === '[PT]' && c[12] === '2026-10-31T23:43:00Z', 'mobile browse shape');
c = s.KickApi_LiveCell({id: 1, session_title: '<script>x</script>', viewer_count: 1, start_time: '2026-10-31 22:33:21',
    thumbnail: {src: 'https://evil.example/a.png'}, channel: {slug: 'a', user: {username: '"><img src=x onerror=1>', profilepic: "https://files.kick.com/a.png'onerror='x"}}});
check(c[1].indexOf('<img') === -1 && c[2].indexOf('<script') === -1 && c[0] === '' && c[9] === '', 'untrusted text escaped, foreign or quoted urls dropped');
check(s.KickApi_Iso('2026-10-31 22:33:21') === '2026-10-31T22:33:21Z' && s.KickApi_Iso('2026-10-31T22:33:22.000000Z') === '2026-10-31T22:33:22.000000Z' && s.KickApi_Iso('x') === '', 'dates as UTC ISO');
const chan = ref('kick_channel.json');
check(s.KickApi_ChannelLiveCell(chan)[14] === 'kick:' + chan.slug && s.KickApi_ChannelLiveCell(chan)[7] === 'kick:' + chan.livestream.id, 'channel live row');
check(s.KickApi_ChannelLiveCell(Object.assign({}, chan, {livestream: null})) === null, 'offline channel has no live row'); // test-only Object.assign is fine (Node)
const v = ref('kick_videos.json').filter(x => !x.is_live)[0];
c = s.KickApi_VodCell(v, {slug: 'xqc', name: 'xQc'});
check(c[7] === 'kick:' + v.video.uuid && c[11] === Math.round(v.duration / 1000) && c[14] === 'kick:xqc' && c[19] === 'kick', 'vod row');
const clip = ref('kick_clips.json').clips[0];
c = s.KickApi_ClipCell(clip);
check(c[0] === clip.clip_url && c[7] === 'kick:' + clip.id && c[8] === null && c[6] === clip.channel.slug, 'clip row plays its m3u8, has no vod');
const f = ref('kick_followed.json').channels[0];
c = s.KickApi_ChannelCell(f);
check(c[0] === f.channel_slug && c[1] === 'kick:' + f.channel_slug.toLowerCase() && c[19] === 'kick', 'followed channel row');
check(s.KickApi_Headers('').length === 2 && s.KickApi_Headers('t')[2][1] === 'Bearer t', 'token header only with a token');
check(s.KickApi_IsKickId('kick:xqc') && !s.KickApi_IsKickId('12345') && !s.KickApi_IsKickId(null), 'kick id test');
check(s.KickApi_CardIcon(c).indexOf('chat_pi_kick') !== -1 && s.KickApi_CardIcon(['', 'tw']) === '', 'kick icon only on kick rows');
```

- [ ] **Krok 3:** `node release/scripts/kick-tests.js` → FAIL (`KickApi_LiveCell is not a function`).
- [ ] **Krok 4: Implementace** podle rozhraní. Ikonka:
  - `+ KickApi_CardIcon(valuesArray) +` do pěti míst výše.
  - CSS `.card_pi.chat_pi_kick, .card_pi.chat_pi_tw { display: inline-block; vertical-align: middle; }`. Bez této třídy je `.chat_pi_tw` mimo propojený chat skrytá.
  - Ve stejném commitu vytvoř `docs/kick-implementation-results.md` s řádkem pro každou úlohu (stav `čeká`).
- [ ] **Krok 5:** Kick test → PASS. `maker.js jsh` a všechny harnessy → zelené (grid-window načítá `Screens.js`, při `ReferenceError` přidej stub `KickApi_CardIcon: () => ''`).
- [ ] **Krok 6: Na TV.** Sestav a nainstaluj, otevři Live (Twitch).
  - CDP `[typeof KickApi_LiveCell, document.querySelectorAll('.card_pi').length]` → `["function", 0]`.
  - Screenshot: karty vypadají jako dřív.
- [ ] **Krok 7:** Commit `Add Kick API module: row builders, safe images, platform icon on cards, fixtures and harness`.

---

### Task 2: Kick větev playlistu, pojistky proti Twitch volání a ladicí otevření

Výsledkem je Kick živý stream otevřený podle slugu z CDP: hraje, má kvality, nízkou latenci a při reconnectu nový token. Žádné Kick ID neodejde do Twitch API.

**Soubory:**
- Upravit:
  - `app/specific/PlayHLS.js`: `PlayHLS_GetPlayListAsync` :71, `PlayHLS_GetPlayListSync` :519, nové funkce na konci.
  - `app/specific/KickApi.js`: `KickApi_LiveCache`, `KickApi_OpenLive`.
  - Volající playlistu (místo `[6]` dávají `PlayHLS_Id(data)`):
    - `Play.js` :356 (`Play_CheckIfIsLiveStart`, živá větev), :496 (`Play_getStreamData` dostane `data` místo jména a volá `PlayHLS_GetPlayListSync(true, PlayHLS_Id(data))`, oba volající v `Play.js` :794 a `PlayExtra.js` :93 posílají `Play_data.data` / `PlayExtra_data.data`), :799,
    - `PlayEtc.js` :994, `PlayExtra.js` :100, `PlayMulti.js` :305,
    - `Screens.js` :1515 (živá větev `Screens_LoadPreviewStart`), `Sidepannel.js` :283–285 (celý řádek místo `[6]`), `UserLiveFeed.js` :794, `ChannelContent.js` :708.
    - `Play_ClipCheckIfIsLive` (`PlayClip.js` :1068) se nemění. Tlačítko „otevřít živé“ se u Kick VOD a klipu neukáže, protože `PlayClip_CheckIsLive` skončí v pojistce (viz níže).
  - `app/specific/Main.js`: `BaseXmlHttpGet` :2122, `FullxmlHttpGet` :2224, nová `Main_KickHelixBlocked`, `Main_StartHistoryworker` :2874, `Main_RunVODWorker` :2909, `Main_RunLiveVODWorker` :2945, `Main_RunClipWorker` :2981.
  - `app/specific/ScreensObj.js`: `ScreensObj_getStreamInfo` :3420.
  - `app/specific/Screens.js`: `Screens_BlockUpdateAllIdsObj` :3760.
  - `app/specific/PlayRaid.js`: `PlayRaid_SetChannel` :46.
  - `app/specific/Play.js`: `Play_updateStreamInfoStart` :552, `Play_updateStreamInfo` :636.
  - `app/specific/ChatLive.js`: `ChatLive_Init` :165.
  - `app/specific/PhoneChat.js`: `PhoneChat_GetChannel` :57.
  - Testy: `release/scripts/kick-tests.js`, `release/scripts/raid-tests.js` (jedna kontrola), `release/scripts/chat-optimization-tests.js` (jedna kontrola a stub).

**Rozhraní:**
- Používá: `KickApi_*` z úlohy 1, `OSInterface_XmlHttpGetFull`, `OSInterface_mMethodUrlHeaders`, `Main_onNewIntentClearPlay`, `Play_data_base`, `Main_openStream`.
- Poskytuje:
  - `PlayHLS_Id(data) -> data[19] === 'kick' ? 'kick:' + data[6] : data[6]`.
  - `PlayHLS_KickPlaylistUrl(isLive, json) -> string | null`:
    - živé: `json.livestream ? json.playback_url : null`,
    - VOD: `json.source`, když končí `.m3u8`, jinak `json.source + 'media/hls/master.m3u8'`,
    - obojí jen `^https:\/\/[a-z0-9.-]+\.(kick\.com|live-video\.net)\/`, jinak `null`.
  - `PlayHLS_KickResult(result, checkResult, check_1, check_2, check_3, check_4, check_5, callBackSuccess)` (Java callback). `check_1` = `'1'` živé, `check_2` = `'info' | 'master'`, `check_3` = slug nebo uuid, `check_4` = URL masteru, `check_5` = CheckId_x.
  - `PlayHLS_KickSync(isLive, ref) -> JSON string`.
  - Výsledek pro callback je JSON `{status, responseText, checkResult, url}`:
    - info ≠ 200 dá `status: response.status === 404 ? 404 : 0`,
    - offline nebo neplatná URL dá `404` (živé) nebo `410` (VOD).
  - `KickApi_LiveCache = {}` (`{slug: řádek z KickApi_ChannelLiveCell}`, plní ho krok info).
  - `KickApi_OpenLive(slug)`: ladicí a pozdější vstup, výsledek v pojmenovaném `KickApi_OpenLiveResult(obj, key, seq)`.
  - `Main_KickHelixBlocked(url) -> /^https:\/\/api\.twitch\.tv\/helix\/[^?]*\?(.*&)?(user_id|id|broadcaster_id)=kick(:|%3A)/i.test(url)`.
- **Decision:** jedna pojistka ve sdílených HTTP funkcích místo stráže v každém z ~12 volajících. Chybové callbacky dělají přesně to, co je pro Kick správně: uložit historii, schovat logo nebo tlačítko „live“ a `Main_CheckBroadcastIDStart` → `Main_openStream`.

- [ ] **Krok 1: Padající testy** (`kick-tests.js`, sandbox s `ChatMulti.js`, `KickApi.js`, `PlayHLS.js`):
  - Stuby: `OSInterface_XmlHttpGetFull: (...a) => calls.push(a)`, `DefaultHttpGetTimeout: 20000`, `PlayClip_BaseUrl: 'https://gql.twitch.tv/gql'`, `Play_Headers: '[]'`, `use_proxy: false`.
  - Callback: `s.Cb = (r, x, y) => results.push(JSON.parse(r))`.

```js
const chanText = fs.readFileSync('jsonreferences/kick_channel.json', 'utf8'), chan = JSON.parse(chanText);
s.PlayHLS_GetPlayListAsync(true, 'kick:' + chan.slug, 77, null, s.Cb);
check(calls[0][0] === 'https://kick.com/api/v2/channels/' + chan.slug && calls[0][5] === 'PlayHLS_KickResult' && calls[0][8] === 'info', 'live: channel info first');
check(!JSON.parse(calls[0][4]).some(h => h[0] === 'Authorization'), 'playback info is public, no token');
s.PlayHLS_KickResult(JSON.stringify({status: 200, responseText: chanText}), 77, '1', 'info', chan.slug, null, 'null', 'Cb');
check(calls[1][0] === chan.playback_url && calls[1][8] === 'master' && calls[1][10] === chan.playback_url, 'then the master, its url carried in check_4');
check(s.KickApi_LiveCache[chan.slug][7] === 'kick:' + chan.livestream.id, 'info step caches the fresh row');
s.PlayHLS_KickResult(JSON.stringify({status: 200, responseText: '#EXTM3U\n'}), 77, '1', 'master', chan.slug, chan.playback_url, 'null', 'Cb');
check(results[0].status === 200 && results[0].url === chan.playback_url && results[0].checkResult === 77 && results[0].responseText === '#EXTM3U\n', 'callback gets status, url, playlist, checkResult');
s.PlayHLS_KickResult(JSON.stringify({status: 200, responseText: JSON.stringify(Object.assign({}, chan, {livestream: null}))}), 78, '1', 'info', chan.slug, null, 'null', 'Cb');
check(results[1].status === 404 && calls.length === 2, 'offline: 404, no master request');
s.PlayHLS_KickResult(JSON.stringify({status: 403, responseText: '{"error":"Request blocked by security policy."}'}), 79, '1', 'info', chan.slug, null, 'null', 'Cb');
check(results[2].status === 0, 'WAF block is a generic error, not forbidden');
s.PlayHLS_GetPlayListAsync(false, 'kick:6c2265bd-60c0-4903-9f78-af76c989a41a', 80, null, s.Cb);
check(calls[2][0] === 'https://kick.com/api/v1/video/6c2265bd-60c0-4903-9f78-af76c989a41a', 'vod: video detail first');
const video = ref('kick_video.json');
check(s.PlayHLS_KickPlaylistUrl(false, video) === video.source && s.PlayHLS_KickPlaylistUrl(false, {source: 'https://stream.kick.com/a/b/'}) === 'https://stream.kick.com/a/b/media/hls/master.m3u8', 'vod master url from source');
check(s.PlayHLS_KickPlaylistUrl(false, {source: 'javascript:alert(1)//.m3u8'}) === null, 'foreign playlist url rejected');
s.PlayHLS_GetPlayListAsync(true, 'robdiesalot', 81, null, s.Cb);
check(calls[3][0] === 'https://gql.twitch.tv/gql', 'twitch path unchanged');
check(s.PlayHLS_Id(['', '', '', '', '', '', 'xqc']) === 'xqc' && s.PlayHLS_Id(Object.assign([], {6: 'xqc', 19: 'kick'})) === 'kick:xqc', 'PlayHLS_Id');
s.OSInterface_mMethodUrlHeaders = url => JSON.stringify(url.indexOf('/api/v2/channels/') !== -1 ? {status: 200, responseText: chanText} : {status: 200, responseText: '#EXTM3U\n'});
const sync = JSON.parse(s.PlayHLS_GetPlayListSync(true, 'kick:' + chan.slug));
check(sync.status === 200 && sync.url === chan.playback_url, 'sync twin, same shape');
```

  Pojistka v `Main.js` (výřez `Main_KickHelixBlocked`, `BaseXmlHttpGet`, `FullxmlHttpGet` se stuby `Main_IsOn_OSInterface: true`, `OSInterface_BaseXmlHttpGet: () => native++`, `AddUser_UserHasToken: () => false`, `Main_Bearer_Headers: []`, `DefaultHttpGetTimeout: 1`):

```js
let err = null; function ok() {} function bad(k, c, o) { err = o; } let got = null; function cb(o) { got = o; }
m.BaseXmlHttpGet('https://api.twitch.tv/helix/streams?user_id=kick:xqc', ok, bad, 0, 5, true);
check(native === 0 && err.status === 0, 'helix with a kick id never leaves the app, error path');
m.BaseXmlHttpGet('https://api.twitch.tv/helix/users?id=123', ok, bad, 0, 5, true);
check(native === 1, 'twitch id passes');
m.FullxmlHttpGet('https://api.twitch.tv/helix/channels/followed?user_id=1&broadcaster_id=kick:xqc', null, cb, cb, 0, 1, null, null);
check(native === 1 && got.status === 0, 'FullxmlHttpGet: success callback with status 0');
```

  Worker historie (výřez `Main_StartHistoryworker`, `Main_RunVODWorker`, `Main_RunLiveVODWorker`, `Main_RunClipWorker`). Uživatel `u`, živé položky `[{data: twRow /*[14]='5'*/}, {data: kickRow /*[14]='kick:xqc'*/}]`, VOD a klipy podobně:
  - `check(posted.length === 1 && posted[0].obj.data[14] === '5' && deleted === 0, 'history worker skips kick entries and never deletes them')`,
  - totéž pro VOD a klipy (`posted` počítá `BradcastCheckerWorker.postMessage`).

  Blokované (výřez `Screens_BlockUpdateAllIdsObj`, `blocked.channel = {'1': {}, 'kick:xqc': {}}`):
  - `check(urls.length === 1 && urls[0].indexOf('kick') === -1 && urls[0].indexOf('id=1') !== -1, 'blocked batch without kick ids')`.

  `raid-tests.js` (stub `KickApi_IsKickId`):
  - `s.PlayRaid_SetChannel('kick:xqc'); checkEqual(s._sockets.length, 0, 'kick channel never subscribes')`.

  `chat-optimization-tests.js` (stub `KickApi_IsKickRow = d => !!d && d[19] === 'kick'`, `ChatLive_loadChat` počítá volání):
  - `Play_data.data[19] = 'kick'; Play_data.data[14] = 'kick:xqc'; s.ChatLive_Init(0); check(loadChatCalls === 0 && s.ChatLive_selectedChannel_id[0] === 'kick:xqc', 'kick row opens no Twitch IRC')`.
- [ ] **Krok 2:** `node release/scripts/kick-tests.js` → FAIL (`s.PlayHLS_KickResult is not a function`), `node release/scripts/raid-tests.js` → FAIL (`kick channel never subscribes`), `node release/scripts/chat-optimization-tests.js` → FAIL (`kick row opens no Twitch IRC`).
- [ ] **Krok 3: Implementace.**
  - `PlayHLS_GetPlayListAsync`: hned na začátku `if (KickApi_IsKickId(id)) { PlayHLS_KickStep(isLive, KickApi_Slug(id), CheckId_y, CheckId_x, callBackSuccess.name); return; }`. Info request jde přes `OSInterface_XmlHttpGetFull` s `JSON.stringify(KickApi_Headers(''))` a callbackem `'PlayHLS_KickResult'`, master bez hlaviček.
  - Dokončení přes `eval(callBackSuccess)(JSON.stringify(res), parseInt(check_5), checkResult)`, stejně jako `PlayHLS_PlayListUrlResult`.
  - **Decision:** do JSON výsledku se vždy vkládá `url` masteru (Java ho nevyplní, viz Review Focus 3).
  - `PlayHLS_GetPlayListSync`: Kick ID → `PlayHLS_KickSync` (dvakrát `OSInterface_mMethodUrlHeaders`, timeout `DefaultHttpGetTimeout / 2`).
  - Pojistka:
    - `BaseXmlHttpGet`: `if (Main_KickHelixBlocked(theUrl)) { calbackError(key, checkResult, {status: 0, responseText: ''}); return; }`,
    - `FullxmlHttpGet`: `callbackSuccess({status: 0, responseText: ''}, key, checkResult); return;`,
    - `ScreensObj_getStreamInfo`: `if (!userId || KickApi_IsKickId(userId)) return;`.
  - Workery historie: v cyklu `if (KickApi_IsKickId(array[i].data[14])) continue;` (u klipů `data[2]`).
  - **Decision:** Kick živé položky historie se worker nekontroluje a nepřevádí na VOD. Zůstanou, otevření offline kanálu ukáže „offline“.
  - `Screens_BlockUpdateAllIdsObj`: `ids` bez Kick ID. `PlayRaid_SetChannel`: `KickApi_IsKickId(channelId)` mezi důvody k `PlayRaid_Close()`.
  - `Play_updateStreamInfoStart`: pro Kick řádek `var fresh = KickApi_LiveCache[Play_data.data[6]]; if (fresh) { Play_data.data = Main_Slice(fresh); Play_UpdateMainStreamDiv(); } return;` (synchronně, takže `Main_Set_history` v `Play_loadDataSuccessEnd` uloží číselné ID livestreamu).
  - `Play_updateStreamInfo` (periodicky) pro Kick řádek: `FullxmlHttpGet(KickApi_Base + 'v2/channels/' + slug, KickApi_Headers(''), Play_KickInfoResult, noop_fun, 0, Play_updateStreamInfoGetId)`. Výsledek zkontroluje ID a slug, obnoví `Play_data.data`, `Play_UpdateMainStreamDiv()` a uloží historii.
  - `ChatLive_Init`: za `ChatLive_SetOptions(...)` vlož `if (KickApi_IsKickRow(!chat_number ? Play_data.data : PlayExtra_data.data)) return;`. Úloha 3 sem doplní Kick chat. `PhoneChat_GetChannel`: `if (Play_data.data[19] === 'kick') return null;`.
  - `ChatLive_SetOptions`: per-channel Twitch loadery (`ChatLive_loadCheersChannel`, BTTV, FFZ, 7TV) jen `if (!KickApi_IsKickId(Channel_id))`.
  - `KickApi_OpenLive(slug)`: GET kanálu. Výsledek: `cell = KickApi_ChannelLiveCell(json)`.
    - Bez `cell` → `Main_showWarningDialog(slug + ' ' + STR_LIVE + STR_IS_OFFLINE, 3000)`.
    - Jinak jako živá větev `Main_onNewIntent` (`Main.js:3424`): `Main_isScene2DocVisible() ? Main_onNewIntentClearPlay() : ScreenObj[Main_values.Main_Go].exit_fun()`, pak `Play_data = JSON.parse(JSON.stringify(Play_data_base)); Play_data.data = cell; Main_values_Play_data = cell; Main_openStream();`.
  - Volající playlistu přepni na `PlayHLS_Id(...)` podle seznamu souborů (pro feed a obrazovky jen živá větev, VOD větev má ID z `[7]` s prefixem).
- [ ] **Krok 4:** Testy → PASS, `maker.js jsh` a všechny harnessy zelené.
- [ ] **Krok 5: Na TV.** Vyber živý kanál (`mobile.kick.com` výše) a přes CDP spusť `KickApi_OpenLive('<slug>')`. Po 15 s vyhodnoť:

```js
[Play_isOn, Play_data.data[19], Play_data.data[7], OSInterface_getPlaybackState(), (Play_getQualities(1, true), Play_data.qualities.map(function (q) { return q.id; }).join())]
```

  - Očekávání: `true, "kick", "kick:<číslo>", true`, kvality obsahují `1080p60` nebo `720p60`.
  - Screenshot: obraz hraje, panel ukazuje titulek a kategorii.
  - Reconnect: CDP `Play_loadData()` a po 10 s znovu `OSInterface_getPlaybackState()` → `true`. Pokaždé se stahuje nový token (`Play_data.AutoUrl` se změní).
  - `ChatLive_socket[0]` neexistuje nebo má `readyState` 3 (žádný Twitch IRC).
  - Nízká latence: nastavení „Low latency“ zapnuté, `Play_ShowVideoStatus` / panel ukazuje latenci pod ~6 s. Zapiš hodnotu.
  - Twitch stream z Live otevřený klávesami hraje jako dřív.
- [ ] **Krok 6:** Commit `Play Kick live streams: playlist branch, Kick-safe Twitch calls, debug open by slug`.

---

### Task 3: Kick hlavní chat, připojený Twitch a YouTube, propojené chaty pro Kick kanál

**Soubory:**
- Upravit:
  - `app/specific/ChatLive.js`: `ChatLive_Init` :165 (Kick větev místo `return` z úlohy 2), `ChatLive_SetOptions` :265 (reset `ChatLive_IrcChannel`), `ChatLive_PreLoadChat` :1132, `ChatLive_loadChat` :1163 (`useToken`), JOIN :1200, :1237, :1471, PART :1416, nové `ChatLive_IrcLogin`, `ChatLive_StartLinkedTwitch`.
  - `app/specific/ChatLink.js`: `ChatLink_LookupUrl` :9, `ChatLink_Resolve` :51, `ChatLink_Lookup` :78, `ChatLink_LookupResult` :90, `ChatLink_Current` :112, nové `ChatLink_Key`, `ChatLink_NormalizeTwitch`.
  - `app/specific/ChatMulti.js`: `ChatMulti_Start` :21, `ChatMulti_OnLinks` :52.
  - `app/specific/ChatLinkDialog.js`: `ChatLinkDialog_Rows` :18, `ChatLinkDialog_Apply` :58, `ChatLinkDialog_ChatLogin` :86, render řádku `tw`.
  - `app/specific/PlayEtc.js`: `Play_controlsPhoneChat` `enterKey` (Kick → `Play_showWarningMiddleDialog(STR_KICK_NOT_SUPPORTED, 2000)`).
  - Řetězce, testy `release/scripts/chat-multi-tests.js` (do `FILES` na začátek `KickApi.js`, do sandboxu `ChatLive_selectedChannel_id = ['', '']`).

**Rozhraní:**
- Používá: `ChatKick_Start/Stop`, `ChatYouTube_Start`, `ChatLive_loadChatRequest`, `ChatLive_PreLoadChat`, `KickApi_IsKickId`, `KickApi_Slug`.
- Poskytuje:
  - `ChatLink_Key(chat_number) -> 'kick:<slug>' | '<twitch login>'` (podle `ChatLive_selectedChannel_id`).
  - `ChatLink_Resolve(entry, dir, platform)`. Pro `platform === 'kick'` vrací `{tw, yt, kick: null}`, kde `tw` je `entry.tw` (ruční), jinak `dir.twitchLogin`. Bez `platform` beze změny.
  - `ChatLink_NormalizeTwitch(input) -> login | null` (`/^(?:https?:\/\/)?(?:www\.)?(?:twitch\.tv\/)?(\w{3,25})\/?$/i`, malými písmeny).
  - Adresář: `https://api.jouki.cz/streamers/lookup?platform=kick&handle=<slug>` pro Kick klíč, jinak `platform=twitch` (cache klíčovaná `ChatLink_Key`).
  - `ChatMulti_Start`: Kick hlavní chat běží i s vypnutým `chat_multi`. Pak bez lookupu rovnou `ChatMulti_OnLinks`, kde se spustí jen `ChatKick`.
  - `ChatMulti_OnLinks`:
    - pro Kick klíč vždy `ChatKick_Start(n, seq, slug, withHistory)`,
    - se zapnutým `chat_multi` navíc `links.tw` → `ChatLive_StartLinkedTwitch(n, state.id, links.tw.value, state.withHistory)` a `links.yt` → `ChatYouTube_Start`,
    - `ChatMulti_SetLinked(n, !!(links.tw || links.yt))`.
  - `ChatLive_IrcChannel = []`, `ChatLive_IrcLogin(n) -> ChatLive_IrcChannel[n] || ChatLive_selectedChannel[n]`.
  - `ChatLive_StartLinkedTwitch(n, id, login, withHistory)`:
    - ověří `id === Chat_Id[n]` a login `/^\w{3,25}$/`,
    - nastaví `ChatLive_IrcChannel[n]` a `useToken[n] = false`,
    - s historií `ChatLive_PreLoadChat`, pak `ChatLive_loadChatRequest(n, id, true)`.
  - `ChatLinkDialog_Rows(entry, resolved, platform)`: pro `'kick'` druhy `tw,yt,enabled[,reset],close`. `ChatLinkDialog_Apply(key, 'tw', raw)`.
  - Řetězce `STR_KICK_NOT_SUPPORTED = 'Not available for Kick streams'`, `STR_CHAT_LINK_TWITCH = 'Twitch'`.
- **Decision:** připojený Twitch jede stávajícím IRC (stejné odznaky, emoty z tagů, moderace, ikonka `tw`) s přepsaným kanálem, vždy anonymně. Kick hlavní chat nemá Twitch per-channel emoty (BTTV, FFZ, 7TV), protože jsou klíčované Twitch ID.

- [ ] **Krok 1: Padající testy** (`chat-multi-tests.js`):

```js
check(s.ChatLink_NormalizeTwitch('https://www.twitch.tv/RobDiesALot') === 'robdiesalot' && s.ChatLink_NormalizeTwitch('a b') === null, 'twitch login');
const kd = {twitchLogin: 'robdiesalot', youtubeChannelId: 'UCROnsopSryzM2WaxxeNICOA', kickSlug: 'robdiesalot'};
let k = s.ChatLink_Resolve({enabled: true}, kd, 'kick');
check(k.tw.value === 'robdiesalot' && k.tw.source === 'dir' && k.yt.value === 'UCROnsopSryzM2WaxxeNICOA' && k.kick === null, 'kick channel links twitch and youtube');
check(s.ChatLink_Resolve({enabled: true, tw: ''}, kd, 'kick').tw === null, 'empty manual twitch disables it');
check(s.ChatLink_Resolve({enabled: true}, kd).kick.value === 'robdiesalot', 'twitch channel resolution unchanged');
s.ChatLive_selectedChannel = ['robdiesalot', '']; s.ChatLive_selectedChannel_id = ['kick:robdiesalot', ''];
let url = ''; s.FullxmlHttpGet = u => { url = u; };
s.ChatLink_Lookup(0, 7);
check(url === 'https://api.jouki.cz/streamers/lookup?platform=kick&handle=robdiesalot', 'kick directory lookup');
check(s.ChatLinkDialog_Rows({enabled: true}, {tw: null, yt: null}, 'kick').map(r => r.kind).join() === 'tw,yt,enabled,close', 'dialog rows for kick');
check(s.ChatLinkDialog_Apply('kick:robdiesalot', 'tw', 'twitch.tv/RobDiesALot') && s.ChatLink_Get('kick:robdiesalot').tw === 'robdiesalot', 'apply twitch link');
```

  Jádro (`coreSandbox`, stuby `ChatKick_Start`, `ChatYouTube_Start` a `ChatLive_StartLinkedTwitch`, které zapisují volání):
  - `chat_multi` 0 a Kick kanál → `ChatMulti_Start(0, 7, true)` → `ChatKick_Start` s `('robdiesalot', true)`, ostatní nic,
  - `chat_multi` 1 a odpověď adresáře `kd` → navíc `StartLinkedTwitch(0, 7, 'robdiesalot', true)` a YouTube,
  - Twitch kanál beze změny (Kick jen z linku).

  `ChatLive_StartLinkedTwitch(0, 6, 'x', true)` při `Chat_Id[0] = 7` → nic (stale).
- [ ] **Krok 2:** `node release/scripts/chat-multi-tests.js` → FAIL (`s.ChatLink_NormalizeTwitch is not a function`).
- [ ] **Krok 3: Implementace** podle rozhraní. Zbytek:
  - `ChatLive_Init` Kick větev: bez `SkipClear` řádek `STR_LOADING_CHAT + ' ' + data[1] + ' ' + STR_LIVE` jako `ChatLive_loadChat`, pak `ChatMulti_Start(chat_number, Chat_Id[chat_number], !SkipClear); return;`.
  - `ChatLive_loadChat`: `useToken[n] = !ChatLive_IrcChannel[n] && …`. JOIN, PART a `recent-messages` přes `ChatLive_IrcLogin(n)`.
  - `ChatLinkDialog`: text řádku `tw` jako `yt`/`kick`, editace přes `ChatLinkDialog_Apply`.
- [ ] **Krok 4:** Testy → PASS, všechny harnessy (chat-optimization potřebuje stuby `ChatLive_StartLinkedTwitch`, `KickApi_IsKickId`).
- [ ] **Krok 5: Na TV.** `KickApi_OpenLive('<živý slug>')`, po 20 s:

```js
[Chat_div[0].querySelectorAll('.chat_pi_kick').length > 0, Chat_div[0].querySelectorAll('.chat_line_holder').length, ChatLive_IrcChannel[0] || '']
```

  - Očekávání: zprávy Kicku včetně historie (první řádky dřív než živé).
  - Připojený Twitch: když nevysílá `robdiesalot` na obou, použij `ChatLink_Save('kick:<slug>', {enabled: true, tw: '<živý twitch login>'}); ChatMulti_Restart(0);`. Do 30 s je `.chat_pi_tw` > 0 a ikonky viditelné. Na konci `ChatLink_Save` vrať (`{enabled: true}`).
  - Dialog „Linked chats“ (klávesy přes panel) ukazuje řádky Twitch a YouTube.
  - Twitch stream: chat funguje jako dřív.
- [ ] **Krok 6:** Commit `Kick main chat for Kick streams with linked Twitch (read-only IRC) and YouTube`.

---

### Task 4: Stránka Kick kanálu, seznam VOD a klipů

**Soubory:**
- Upravit:
  - `app/specific/ChannelContent.js`:
    - `ChannelContent_loadDataRequest` :128 (Kick větev),
    - nový `ChannelContent_KickResult(obj, key, seq)`,
    - `ChannelContent_loadDataSuccess` :229 (`stream.kickCell ||`),
    - `ChannelContent_keyEnter` :414 (offline řádek `[19]`, follow v úloze 12).
  - `app/specific/Screens.js`: `Screens_loadDataRequest` :442 (Kick větev), `Screens_HttpResultStatus` :477 (Kick chyby).
  - `app/specific/ScreensObj.js`:
    - `ScreensObj_InitChannelVod` :1195 a `ScreensObj_InitChannelClip` :1912 (`set_url` / `concatenate` Kick větve),
    - `Base_Vod_obj.addCell` :516, `Base_Clip_obj.addCell` :729, `Base_Live_obj.addCellTemp` :593, `Base_Channel_obj.addCellTemp` :903 (`cell.kickCell || …`).

**Rozhraní:**
- Používá: `KickApi_ChannelLiveCell`, `KickApi_VodCell`, `KickApi_ClipCell`, `KickApi_Item`, `KickApi_Img`, `KickApi_Headers`.
- Poskytuje:
  - Kick obrazovka nastaví v `set_url` `this.isKick = true` a `this.url`. `Screens_loadDataRequest` pak (po vytvoření ticketu) volá `FullxmlHttpGet(this.url, KickApi_Headers(''), Screens_HttpResultStatus, noop_fun, key, ticket.id, null, null)` a ticket dostane `kick: true`. Všechny Kick obrazovky přes tuto cestu jsou veřejné (kanál, procházení, vyhledávání). Přihlášená volání Following mají vlastní požadavky v úlohách 8 a 9.
  - `Screens_HttpResultStatus`, Kick ticket a status ≠ 200: `Screens_loadDataFail(key); return;`. Twitch logika validace tokenu a app tokenu se pro Kick nespouští.
  - `concatenate` Kick obrazovky převede odpověď na `{edges | data: [KickApi_Item(...)]}` a volá `concatenateAfter`.
  - `ChannelContent_KickResult` nastaví:
    - `ChannelContent_profile_banner = KickApi_Img(json.banner_image && json.banner_image.url) || IMG_404_BANNER`,
    - `ChannelContent_offline_image = KickApi_Img(json.offline_banner_image && json.offline_banner_image.src) || null`,
    - `ChannelContent_selectedChannelFollower = json.followers_count || ''`,
    - `ChannelContent_description = Screens_AriaEscape(json.user && json.user.bio || '')`,
    - `Main_values.Main_selectedChannelLogo = KickApi_Img(json.user.profile_pic) || IMG_404_LOGO`, `Main_selectedChannelPartner = false`,
    - `ChannelContent_responseText = cell ? [{kickCell: cell, is_mature: json.livestream.is_mature}] : null`,
    - pak `ChannelContent_loadDataSuccess()`.
- **Decision:** Kick seznam VOD vynechá položku `is_live: true` (běžící stream, `duration: 0`). Přepínače období a highlightů se pro Kick ignorují (načte se vždy stejný seznam).
- **Decision:** stránkování klipů: `nextCursor` je objekt (`{"view":0,"id":"clip_…"}`). Krok 1 ověří, jak ho poslat zpět. Když to nejde, načte se jen první stránka (`dataEnded = true`).

- [ ] **Krok 1: Sonda.** Zjisti tvar druhé stránky klipů:
  - `curl -s -A "$UA" 'https://kick.com/api/v2/channels/xqc/clips?cursor=<encodeURIComponent(JSON.stringify(nextCursor))>'` a varianta s `cursor=<id>`.
  - Zapiš do výsledků, co funguje.
  - Uprav `kick_clips.json`, aby obsahoval `nextCursor` z reálné odpovědi.
- [ ] **Krok 2: Padající testy** (`kick-tests.js`, výřez `Screens_loadDataRequest` a `Screens_HttpResultStatus` jako v `following-tests.js`, `ScreenObj[9]` je fake Kick obrazovka s `isKick: true, url: 'https://kick.com/api/v2/channels/xqc/videos'`):

```js
s.Screens_loadDataRequest(9);
check(req[0][0] === 'https://kick.com/api/v2/channels/xqc/videos' && req[0][2].name === 'Screens_HttpResultStatus' && !req[0][1].some(h => h[0] === 'Client-ID'), 'kick screen: kick url, no twitch headers');
req[0][2]({status: 401, responseText: ''}, 9, String(req[0][5]));
check(failed === 1 && validated === 0 && appToken === 0, 'kick 401/403: plain failure, twitch token never validated');
s.Screens_loadDataRequest(9); req[1][2]({status: 200, responseText: '[]'}, 9, String(req[0][5]));
check(accepted === 0, 'older kick request discarded');
const items = s.ScreensObj_KickVodItems(ref('kick_videos.json'), {slug: 'xqc', name: 'xQc'});
check(items.every(i => i.kickCell[19] === 'kick' && i.id.indexOf('kick:') === 0) && !items.some(i => i.kickCell[11] === 0), 'vod items, running stream skipped');
check(s.ScreensObj_KickClipItems(ref('kick_clips.json')).length === ref('kick_clips.json').clips.length, 'clip items');
```

  (`ScreensObj_KickVodItems(json, ch)` a `ScreensObj_KickClipItems(json)` jsou čisté funkce v `ScreensObj.js` volané z `concatenate`.)

  `ChannelContent` (sandbox s `ChannelContent.js`, stub `ChannelContent_loadDataSuccess`):
  - `ChannelContent_KickResult` s `kick_channel.json` a `bio: '<img src=x onerror=1>'` → `ChannelContent_responseText[0].kickCell[14] === 'kick:' + slug` a `ChannelContent_description.indexOf('<img') === -1`,
  - stale `seq` → `loadDataSuccess` nevolán.
- [ ] **Krok 3:** `node release/scripts/kick-tests.js` → FAIL (požadavek jde na Twitch: `kick screen: kick url, no twitch headers`).
- [ ] **Krok 4:** Implementace podle rozhraní.
- [ ] **Krok 5:** Testy a harnessy → PASS. Following-tests musí zůstat zelené: Kick větev se volá až za `ScreenObj[key].isKick &&`.
- [ ] **Krok 6: Na TV.** Přes CDP otevři stránku Kick kanálu:

```js
ScreenObj[Main_values.Main_Go].exit_fun && ScreenObj[Main_values.Main_Go].exit_fun();
Main_values.Main_selectedChannel = 'xqc'; Main_values.Main_selectedChannel_id = 'kick:xqc'; Main_values.Main_selectedChannelDisplayname = 'xQc';
Main_values.Main_selectedChannelLogo = ''; Main_values.Main_BeforeChannel = Main_Live; Main_values.Main_Go = Main_ChannelContent; Main_SwitchScreen();
```

  - Screenshot: logo, banner, počet sledujících, karta živého streamu nebo offline.
  - Klávesy na „Videos“ → seznam VOD s ikonkou Kicku. Zpět → „Clips“ → seznam klipů.
  - OK na živé kartě → hraje (Kick chat).
- [ ] **Krok 7:** Commit `Kick channel page with live card, videos and clips lists`.

---

### Task 5: Přehrávání Kick VOD a klipů

**Soubory:**
- Upravit:
  - `app/specific/PlayVod.js`:
    - `PlayVod_get_vod_info` :1445 (Kick: `Main_Set_history('vod', Main_values_Play_data); PlayVod_ProgressBarrUpdate(Main_vodOffset, Play_DurationSeconds, true); return;`, žádné GQL, náhledy ani kapitoly),
    - `PlayVod_PosStart` :196 (`PlayClip_CheckIsLive` pro Kick vynechá pojistka v `BaseXmlHttpGet`, nic dalšího).
  - `app/specific/ChatVod.js`: `Chat_Init` :91 (Kick VOD → `Chat_Clear(); Chat_SingleLine(STR_KICK_NO_VOD_CHAT); return;`).
  - `app/specific/PlayClip.js`:
    - `PlayClip_Start` :47 (Kick klip vynechá `PlayClip_loadVodOffsett`),
    - `PlayClip_loadDataRequest` :274 (Kick větev),
    - nový `PlayClip_KickResult(obj, key, id)`,
    - `PlayClip_onPlayer` :416 (Kick → `OSInterface_StartAuto(PlayClip_playingUrl, PlayClip_KickPlaylist, 2, …, 0)`).
  - Řetězce.

**Rozhraní:**
- Používá: Kick větev `PlayHLS` (VOD přes `v1/video/<uuid>`, hotovo v úloze 2), `KickApi_IsKickId`, `Main_values_Play_data[19]`.
- Poskytuje:
  - `PlayClip_IsKick() -> Main_values_Play_data && Main_values_Play_data[19] === 'kick'`.
  - `PlayClip_KickPlaylist` (text media playlistu klipu).
  - `PlayClip_KickResult` naplní `PlayClip_QualityStart([{id: 'Auto | hls', url: ChannelClip_playUrl}])`. Chyba → `PlayClip_loadDataError()`.
  - `STR_KICK_NO_VOD_CHAT = 'Chat replay is not available for Kick videos'`.
- **Decision:** Kick klip je HLS media playlist (`clip_url` i `video_url` jsou `.m3u8`). Hraje jako HLS typ 2 se staženým textem playlistu a skutečnou URL (relativní segmenty `521.ts`), ne jako MP4 typ 3.
- **Decision:** v Kick VOD a klipu se nenabízí „otevřít živé“ (pojistka v `BaseXmlHttpGet` volá `PlayClip_SetOpenLiveError`).

- [ ] **Krok 1: Padající testy** (`kick-tests.js`):
  - `PlayClip_loadDataRequest` s Kick klipem (`Main_values_Play_data = KickApi_ClipCell(clip)`, `ChannelClip_playUrl = clip.clip_url`) → `FullxmlHttpGet` na `clip.clip_url` s callbackem `PlayClip_KickResult` a `null, null`.
  - `PlayClip_KickResult({status: 200, responseText: '#EXTM3U\n#EXTINF:2.000,\n521.ts\n'}, 0, PlayClip_loadDataRequestId)` → `PlayClip_KickPlaylist` obsahuje `521.ts` a `PlayClip_QualityStart` dostal URL klipu.
  - `PlayClip_onPlayer()` (stub `OSInterface_StartAuto` zapisuje argumenty, `Main_IsOn_OSInterface = true`, `PlayClip_isOn = true`) → `args[2] === 2 && args[1] === PlayClip_KickPlaylist && args[0] === clip.clip_url`.
  - Twitch řádek → `args[2] === 3 && args[1] === ''` (beze změny).
  - `Chat_Init` s `Main_values.ChannelVod_vodId = 'kick:6c22…'` → `Chat_SingleLine` dostal `STR_KICK_NO_VOD_CHAT` a `ChatLive_SetOptions` nevolán.
  - `PlayVod_get_vod_info` Kick → `FullxmlHttpGet` nevolán, `Main_Set_history` dostal `('vod', row)`.
- [ ] **Krok 2:** `node release/scripts/kick-tests.js` → FAIL (`s.PlayClip_KickResult is not a function`).
- [ ] **Krok 3:** Implementace. **Krok 4:** PASS a všechny harnessy.
- [ ] **Krok 5: Na TV** (stránka kanálu z úlohy 4):
  - VOD: OK na první kartě, po 15 s `[PlayVod_isOn, OSInterface_gettime() > 0, Play_DurationSeconds]`.
  - Posun vpřed (klávesa vpravo dvakrát) → čas se zvětší.
  - Chat ukazuje „Chat replay is not available for Kick videos“.
  - Zavři po ~2 minutách a otevři znovu → nabídne pokračování od uložené pozice (dialog „Continue“). S debug uživatelem bez přihlášení se historie neukládá (`Main_Set_history` vyžaduje uživatele), to se pak ověří v úloze 7.
  - Klip: OK na první klip → hraje do konce, `PlayClip_isOn`, obraz se hýbe (dva screenshoty po 3 s).
- [ ] **Krok 6:** Commit `Play Kick videos and clips (HLS clips, no VOD chat, position in history)`.

---

### Task 6: 50/50, PiP a čtyři streamy s Kickem, Kick položky v historii

**Soubory:**
- Upravit:
  - `app/specific/PlayExtra.js`: `PlayExtra_updateStreamInfo` :453 (Kick: `FullxmlHttpGet` kanálu → obnovit `PlayExtra_data.data` a `PlayExtra_UpdatePanel()`).
  - `app/specific/PlayMulti.js`: `Play_updateStreamInfoMulti` :24 (Kick: totéž do `Play_MultiArray[pos].data` a `Play_MultiUpdateInfo`).
  - Sdílí jednu pojmenovanou funkci `Play_KickInfoResult(obj, key, id)`, kde `key` = `'main' | 'pp' | <pos>`. Rozšíří `Play_KickInfoResult` z úlohy 2.

**Rozhraní:**
- Používá: `KickApi_ChannelLiveCell`, `Main_Set_history`.
- Poskytuje: `Play_KickInfoApply(target, json) -> boolean`, čistá funkce. Vrátí `false`, když slug ze slotu neodpovídá nebo stream skončil. Jinak přepíše řádek čerstvým (titulek, diváci, kategorie, číselné `[7]`).

- [ ] **Krok 1: Padající testy:**
  - `Play_KickInfoApply({data: kickRowXqc}, chanBuddha) === false` (jiný kanál, slot se nemění).
  - `Play_KickInfoApply({data: kickRowBuddha}, chanBuddha) === true && slot.data[13] === chanBuddha.livestream.viewer_count`.
  - `Play_KickInfoResult` se starým `id` → nic.
  - Smíšený multistream: `PlayHLS_Id(Play_MultiArray[i].data)` pro Twitch a Kick slot vrací `'robdiesalot'` a `'kick:buddha'` (fake pole).
- [ ] **Krok 2:** `node release/scripts/kick-tests.js` → FAIL (`s.Play_KickInfoApply is not a function`).
- [ ] **Krok 3:** Implementace. **Krok 4:** PASS a harnessy.
- [ ] **Krok 5: Na TV.**
  - Otevři Twitch živý stream (Live, OK).
  - Přes CDP připrav Kick řádek: `PlayHLS_GetPlayListAsync(true, 'kick:<živý slug>', 1, null, noop_fun)`, po 3 s je v `KickApi_LiveCache['<slug>']`.
  - Vlož ho do panelu a spusť PiP:

```js
var p = UserLiveFeed_FeedPosX; UserLiveFeed_DataObj[p][UserLiveFeed_FeedPosY[p]] = Main_Slice(KickApi_LiveCache['<slug>']); PlayExtra_KeyEnter();
```

  - Po 10 s `[PlayExtra_PicturePicture, PlayExtra_data.data[19], Chat_div[1].querySelectorAll('.chat_pi_kick').length > 0]` → `true, 'kick', true`.
  - Screenshot: dva obrazy.
  - Přepni na 50/50 (ovládání PiP podle `docs/ui-ux-remote-matrix.md` řádek PiP) a prohoď hlavní (`ChatLive_Switch`): chaty se prohodí bez zdvojení.
  - Čtyři streamy: vlož Kick řádek stejně a spusť `Play_MultiStartPrestart()` → 2 Twitch + 1–2 Kick hrají.
  - Kombinace Kick/Kick: hlavní otevři přes `KickApi_OpenLive`, PiP vlož jako výše.
  - Historie: `Main_values_History_data[AddUser_UsernameArray[0].id].live.filter(function (h) { return /^kick:/.test(h.id); }).length > 0` (jen s uživatelem, jinak až v úloze 7). Obrazovka Historie Live ukazuje Kick kartu s ikonkou.
- [ ] **Krok 6:** Commit `Kick in picture-in-picture, 50/50 and multistream with live info refresh`.

---

### Task 7: Kick účty – QR přihlášení, samostatný uživatel a připojení k Twitch uživateli

**Soubory:**
- Vytvořit: `app/specific/KickUser.js` (script tag za `KickApi.js`).
- Upravit:
  - `app/index.html`: dialog `dialog_kick_login` vedle `main_dialog_user` (:3702): `<canvas id="kick_login_qr">`, `kick_login_text`, `kick_login_status`, styl jako `main_dialog_user`. Třetí tlačítko `main_dialog_user_kick` za `main_dialog_user_remove` (:3708).
  - `app/specific/Users.js`:
    - `Users_loadData` :90 (druhá pevná buňka „Add Kick user“ `0_1`, uživatelé od `x = 2`),
    - `Users_createCell` :145 (`KickApi_CardIcon` u uživatele s `kick`),
    - `Users_keyEnter` :228 (`0_1` → `KickLogin_Show({link: -1})`),
    - `Users_showUserDialog` :247 a `Users_UserCursorSet` :269 (třetí tlačítko),
    - `Users_handleKeyDown` :406 (meze kurzoru 0–2),
    - `Users_handleKeyEnter` :329 (kurzor 2 → link, unlink nebo relogin).
  - `app/specific/AddUser.js`: `AddUser_handleKeyDown` :58 (`KEY_ENTER` → `KickLogin_Show({link: -1})`), `AddUser_getCodeSuccess` (nápověda `STR_KICK_ADD_USER_HINT` pod kódem), `AddUser_UpdateUser` :315 (Kick-only přeskočit).
  - `app/specific/OSInterface.js`: `OSInterface_UpdateUserId` :454 (Kick-only uživatel → jako `null`, tedy žádné Twitch notifikace ani kanály).
  - Řetězce.

**Rozhraní:**
- Používá: `PhoneChat_DrawQr(canvas, url)`, `ChatKick_PusherFallback`, `ChatKick_ParseJson`, `ChatKick_EventName`, `ChatKick_Send`, `KickApi_Headers`, `AddUser_SaveUserArray`, `Main_values_History_data`.
- Poskytuje (`KickUser.js`):
  - Uživatel:
    - `user.kick = {id, username, slug, logo, token, date, expired?}` (bez e-mailu).
    - Samostatný uživatel `{platform: 'kick', id: 'kick:<user id>', name: slug, display_name: username, logo, access_token: '', date, refresh_token: 0, expires_in: 0, expires_when: 0, timeout_id: null, kick: {...}}`.
  - `KickUser_IsKickOnly(user) -> !!user && user.platform === 'kick'` (bez argumentu bere `AddUser_UsernameArray[0]`).
  - `KickUser_Token() -> string`: token hlavního uživatele, `''` bez Kicku nebo po vypršení.
  - `KickUser_Expired()`: nastaví `kick.expired = true`, uloží a jednou za běh ukáže `Main_showWarningDialog(STR_KICK_SESSION_EXPIRED, 5000)`.
  - `KickUser_Store(info, token, mode)` (`mode.link >= 0` → připojit k uživateli na pozici, `-1` → nový uživatel). Nastaví `date = now` (záloha na Google Drive pak vezme novější verzi) a `Users_status = false`.
  - `KickUser_Unlink(pos)`.
  - QR:
    - `KickLogin_NewCode(random) -> {uuid, key}`: UUID v4 velkými písmeny, klíč 6 číslic, `random` je volitelná náhrada `Math.random`.
    - `KickLogin_QrUrl(code) -> 'https://kick.com/tv/login?uuid=' + uuid + '&code=' + key`.
    - `KickLogin_Session = {seq, uuid, key, mode, ws, timer, started}`, `KickLogin_PollMs = 3000`, `KickLogin_TimeoutMs = 300000`.
    - `KickLogin_Show(mode)`, `KickLogin_Hide()`, `KickLogin_HandleKeyDown(e)` (Zpět zavře, OK po vypršení vygeneruje nový kód).
    - Pojmenované callbacky `KickLogin_AuthResult(obj, key, seq)` a `KickLogin_UserResult(obj, key, seq)`.
    - `KickLogin_Accept(token, mode) -> seq` (vstup i pro CDP). Založí sezení bez QR a socketu a pošle `GET /api/v1/user`.
  - Pusher `wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.3.0&flash=false`. Po `pusher:connection_established` subscribe `tv-setup-<UUID>`. Na `SetupTvEvent` hned POST, jinak POST každé 3 s.
  - `POST https://kick.com/api/tv/link/authenticate/<UUID>`: tělo `{"key":"<KEY>"}`, hlavičky `KickApi_Headers('')` + `['Content-Type', 'application/json']`. 403 = čekat, 200 = `{token}`, jiné = čekat do vypršení.
  - Pak `GET https://kick.com/api/v1/user` s Bearer → `KickUser_Store({id, username, profilepic}, token, mode)`.
  - Řetězce `STR_KICK_ADD_USER`, `STR_KICK_ADD_USER_HINT = 'Press OK to sign in with Kick instead'`, `STR_KICK_LINK = 'Link Kick account'`, `STR_KICK_UNLINK = 'Unlink Kick account'`, `STR_KICK_RELOGIN = 'Sign in to Kick again'`, `STR_KICK_LOGIN_TITLE = 'Sign in with Kick'`, `STR_KICK_LOGIN_TEXT = 'Scan the code with your phone and confirm in the Kick app'`, `STR_KICK_LOGIN_WAIT = 'Waiting for confirmation'`, `STR_KICK_LOGIN_EXPIRED = 'The code expired, press OK for a new one'`, `STR_KICK_LOGIN_FAIL = 'Kick sign in failed'`, `STR_KICK_SESSION_EXPIRED = 'Kick sign in expired, sign in again in Users'`.
- **Decision:** vypršení Kick session nespouští QR automaticky (běh bez obsluhy). Uživatel uvidí upozornění a v dialogu uživatele tlačítko „Sign in to Kick again“.
- **Decision:** QR kód platí 5 minut, pak „expired“.

- [ ] **Krok 1: Padající testy** (`kick-tests.js`, sandbox `ChatMulti.js`, `ChatKick.js`, `KickApi.js`, `KickUser.js`; `FakeWebSocket` zapisuje `sent`; `Main_setTimeout` ukládá timery do mapy; `FullxmlHttpGet` zapisuje požadavky; `AddUser_UsernameArray = [{id: '160028137', name: 'lordboos', display_name: 'LordBoos', access_token: 'tw', date: 1}]`; `AddUser_SaveUserArray` počítá volání):

```js
let i = 0; const vals = [0.1, 0.9, 0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.05];
const code = s.KickLogin_NewCode(() => vals[i++ % vals.length]);
check(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(code.uuid) && /^\d{6}$/.test(code.key), 'uppercase v4 uuid, 6 digit key');
check(s.KickLogin_QrUrl({uuid: 'ABC', key: '123456'}) === 'https://kick.com/tv/login?uuid=ABC&code=123456', 'qr text');
s.KickLogin_Show({link: -1});
const ses = s.KickLogin_Session, ws = sockets[0];
check(ws.url === 'wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.3.0&flash=false', 'pusher url');
ws.onmessage({data: JSON.stringify({event: 'pusher:connection_established', data: '{"socket_id":"1.2"}'})});
check(JSON.parse(ws.sent[0]).data.channel === 'tv-setup-' + ses.uuid, 'subscribes to tv-setup channel');
ws.onmessage({data: JSON.stringify({event: 'App\\Events\\SetupTvEvent', channel: 'tv-setup-' + ses.uuid, data: '[]'})});
let post = req[req.length - 1];
check(post[0] === 'https://kick.com/api/tv/link/authenticate/' + ses.uuid && post[6] === 'POST' && post[7] === '{"key":"' + ses.key + '"}' && post[1].some(h => h[0] === 'Content-Type' && h[1] === 'application/json'), 'confirmation posts authenticate');
s.KickLogin_AuthResult({status: 403, responseText: '{"message":"Invalid setup UUID and Key"}'}, 0, ses.seq);
check(req.length === 1 && pendingTimers() === 1, '403 keeps waiting with one poll timer');
s.KickLogin_AuthResult({status: 200, responseText: '{"token":"1|abc"}'}, 0, ses.seq);
const me = req[req.length - 1];
check(me[0] === 'https://kick.com/api/v1/user' && me[1].some(h => h[1] === 'Bearer 1|abc') && me[6] === null, 'token fetches the kick user');
s.KickLogin_UserResult({status: 200, responseText: JSON.stringify({id: 42, username: 'Tester', email: 'a@b.c', profilepic: 'https://files.kick.com/images/user/42/p.webp'})}, 0, ses.seq);
const u = s.AddUser_UsernameArray[1];
check(u.platform === 'kick' && u.id === 'kick:42' && u.access_token === '' && u.kick.token === '1|abc' && u.kick.slug === 'tester' && JSON.stringify(u).indexOf('a@b.c') === -1, 'standalone kick user, no email stored');
check(ws.closed && s.KickLogin_Session === null && s.Main_values_History_data['kick:42'], 'socket closed, session cleared, history slot created');
s.KickLogin_Show({link: 0}); const ses2 = s.KickLogin_Session; s.KickLogin_Hide();
s.KickLogin_AuthResult({status: 200, responseText: '{"token":"2|x"}'}, 0, ses2.seq);
check(!s.AddUser_UsernameArray[0].kick && pendingTimers() === 0, 'closed dialog: late answers ignored, no timers left');
const seq3 = s.KickLogin_Accept('3|y', {link: 0}); s.KickLogin_UserResult({status: 200, responseText: '{"id":7,"username":"LordBoos"}'}, 0, seq3);
check(s.AddUser_UsernameArray[0].kick.username === 'LordBoos' && s.AddUser_UsernameArray[0].date > 1, 'link to twitch user bumps date');
check(s.KickUser_Token() === '3|y', 'token of main user');
s.KickUser_Expired(); s.KickUser_Expired();
check(s.KickUser_Token() === '' && warnings === 1, 'expired once warned, token unusable');
```

  - Vypršení: 100 timeoutů ankety (`advance(3000)` × 100) → `kick_login_status` text `STR_KICK_LOGIN_EXPIRED` a socket zavřený.
  - Záloha (výřez `GDriveSyncBackupsByArray` z `BackupSync.js`): `GDriveSyncBackupsByArray([{id: '1', date: 2, kick: {token: 't'}}], local = [{id: '1', date: 1}], {}, {}, true)` → `local[0].kick.token === 't'`. Samostatný `{id: 'kick:42', …}` se přidá jako nový uživatel.
  - `OSInterface_UpdateUserId` s Kick-only uživatelem → `Android.UpdateUserId(null, null, null)`.
  - `AddUser_UpdateUser` Kick-only → žádný požadavek.
- [ ] **Krok 2:** `node release/scripts/kick-tests.js` → FAIL (`s.KickLogin_NewCode is not a function`, `KickUser.js` zatím neexistuje).
- [ ] **Krok 3:** Implementace. QR dialog:
  - `Users_handleKeyDown` předá klávesy `KickLogin_HandleKeyDown`, když je dialog vidět (vzor `PhoneChat_HandleKeyDown`).
  - Canvas vykreslí `PhoneChat_DrawQr(Main_getElementById('kick_login_qr'), KickLogin_QrUrl(ses))`.
  - Fokus na dialogu podle `DESIGN.md` (fokus `#bca0ff`).
- [ ] **Krok 4:** PASS a všechny harnessy.
- [ ] **Krok 5: Na TV.**
  - Users: první řada má „Add user“ a „Add Kick user“. OK na Kick → dialog s QR (screenshot, QR čitelný).
  - `KickLogin_Session.uuid` má 36 znaků, Pusher připojen: `KickLogin_Session.ws.readyState === 1`. Zpět zavře.
  - Token: `node kick-token.js` s `{link: 0}`, když debug aplikace má Twitch uživatele, jinak `{link: -1}`.
  - Pak `[AddUser_UsernameArray.length, !!AddUser_UsernameArray[0].kick, KickUser_Token().length > 0]` a Users ukazuje ikonku Kicku.
  - Dialog uživatele má třetí tlačítko „Unlink Kick account“ (neodpojuj).
  - **Ráno s uživatelem:** QR přihlášení telefonem (sken, potvrzení v aplikaci Kick, do 10 s nový nebo připojený účet). Zapiš do výsledků jako „čeká na ranní ověření“.
- [ ] **Krok 6:** Commit `Kick accounts: QR sign in, standalone Kick user and Kick account linked to a Twitch user`.

---

### Task 8: Following Live, panel v přehrávači a boční panel se sloučenými streamy

**Soubory:**
- Upravit:
  - `app/specific/KickUser.js`: `KickFollow_*`.
  - `app/specific/ScreensObj.js`: `ScreensObj_InitUserLive` :1668 (`concatenate` a `kickOnlyResponse: '{"data":[],"pagination":{}}'`).
  - `app/specific/Screens.js`: `Screens_loadDataRequest` :442 (Kick-only uživatel: `if (ScreenObj[key].kickOnlyResponse && KickUser_IsKickOnly()) { Screens_HttpResultStatus({status: 200, responseText: ScreenObj[key].kickOnlyResponse}, key, ticket.id); return; }` hned za vytvořením ticketu).
  - `app/specific/UserLiveFeedobj.js`:
    - `UserLiveFeedobj_loadChannelUserLive` :1227 (Kick-only → `UserLiveFeedobj_loadDataSuccess('{}')`),
    - `UserLiveFeedobj_loadDataSuccess` :1258 (sloučení na první stránce),
    - `UserLiveFeed_loadDataSuccessEnd` :1289 (`mArray = stream.kickCell || ScreensObj_LiveQueryCellArray(stream)`),
    - `UserLiveFeedobj_loadDataError` :166 (Kick-only bez tokenu nepíše `STR_NOKUSER_WARNING`).
  - `app/specific/KickApi.js`: `KickApi_CardIcon` (Twitch ikonka `tw`, když má hlavní uživatel Kick).

**Rozhraní:**
- Používá: `KickUser_Token`, `KickApi_LiveCell`, `KickApi_Item`, `Navigation_FeedFull`, `Navigation_Account`.
- Poskytuje:
  - `KickFollow_Url = 'https://kick.com/api/v1/user/livestreams'`.
  - `KickFollow_MergeHelix(twitchData, kickItems) -> array`: Kick položky vložené podle `viewer_count` sestupně, pořadí Twitche zachováno.
  - `KickFollow_FeedNodes(list) -> [{kickCell, stream: {viewersCount, createdAt, broadcaster: {login, id}, game: {displayName}, is_mature}}]` (uzly pro stávající třídění panelu).
  - `KickFollow_Start(key, responseObj) -> boolean`. `true` = Twitch odpověď uložena do `ScreenObj[key].kickPending` a Kick request odeslán s `checkResult = ScreenObj[key].navigationRequest.id`. Výsledek přijde do `KickFollow_LiveResult(obj, key, requestId)` (pojmenovaný, kontrola ticketu a účtu jako `Screens_HttpResultStatus`). `false` bez tokenu nebo na další stránce.
  - `KickFollow_FeedStart(response) -> boolean` a `KickFollow_FeedResult(obj, pos, check)` přes `Navigation_FeedFull`.
  - Chyba Kicku → Twitch data beze změny. 401 → `KickUser_Expired()`.
- **Decision:** obrazovka Following Live drží pořadí Twitche (diváci sestupně) a Kick vkládá podle diváků. Panel a boční panel sloučí a pak třídí stávajícím `live_feed_sort`. Kick se slučuje jen do první stránky.
- **Decision:** ikonka Twitche na Twitch kartách jen pro uživatele s Kickem (`KickApi_CardIcon` vrací `tw` ikonku, když `KickUser_Token()`).

- [ ] **Krok 1: Padající testy:**

```js
const tw = [{viewer_count: 900, user_id: '1'}, {viewer_count: 100, user_id: '2'}];
const kick = [s.KickApi_Item(s.KickApi_LiveCell(Object.assign({}, live, {viewer_count: 500})), 'a', 'kick:a', false),
              s.KickApi_Item(s.KickApi_LiveCell(Object.assign({}, live, {viewer_count: 50})), 'b', 'kick:b', false)];
kick.forEach(k => { k.viewer_count = k.kickCell[13]; });
check(s.KickFollow_MergeHelix(tw, kick).map(v => v.viewer_count).join() === '900,500,100,50', 'kick inserted by viewers, twitch order kept');
s.KickUser_Token = () => '';
check(!s.KickFollow_Start(5, {data: tw}) && req.length === 0, 'twitch-only user: no kick request (Review Focus 5)');
s.KickUser_Token = () => 'T';
s.ScreenObj = {5: {data: null, navigationRequest: {id: 9, account: 'u'}, concatenateAfter: r => out.push(r)}}; s.Navigation_Account = () => 'u';
check(s.KickFollow_Start(5, {data: tw.slice(), pagination: {}}) && req[0][0] === 'https://kick.com/api/v1/user/livestreams' && req[0][1].some(h => h[1] === 'Bearer T'), 'first page asks kick with the token');
s.Navigation_Account = () => 'other';
s.KickFollow_LiveResult({status: 200, responseText: JSON.stringify([live])}, 5, 9);
check(out.length === 0, 'account switched: kick result dropped (Review Focus 4)');
s.Navigation_Account = () => 'u';
s.KickFollow_LiveResult({status: 200, responseText: JSON.stringify(ref('kick_user_livestreams.json'))}, 5, 9);
check(out[0].data.length === 2 + ref('kick_user_livestreams.json').length && out[0].data.some(d => d.kickCell), 'merged first page delivered');
s.ScreenObj[5].kickPending = {data: tw.slice()}; s.KickFollow_LiveResult({status: 401, responseText: ''}, 5, 9);
check(out[1].data.length === 2 && expired === 1, 'kick 401: twitch data alone, session expired');
const nodes = s.KickFollow_FeedNodes(ref('kick_user_livestreams.json'));
check(nodes[0].kickCell[19] === 'kick' && nodes[0].stream.viewersCount === ref('kick_user_livestreams.json')[0].viewer_count, 'feed nodes sortable like gql nodes');
```

  - `Screens_loadDataRequest` (výřez) s `kickOnlyResponse` a Kick-only uživatelem → žádný `FullxmlHttpGet`, `concatenate` dostal `{data: [], pagination: {}}`.
  - Twitch uživatel → stávající požadavek.
- [ ] **Krok 2:** `node release/scripts/kick-tests.js` → FAIL (`s.KickFollow_MergeHelix is not a function`).
- [ ] **Krok 3:** Implementace:
  - `ScreensObj_InitUserLive.concatenate = function (r) { if (!this.data && KickFollow_Start(this.screen, r)) return; this.concatenateAfter(r); }`.
  - V `KickFollow_LiveResult` položky převedené `KickApi_Item(cell, cell[7], cell[14], ls.is_mature)` s `viewer_count`, pak `concatenateAfter({data: merged, pagination: pending.pagination || {}})`.
  - Panel: v `UserLiveFeedobj_loadDataSuccess` před `UserLiveFeed_loadDataSuccessEnd(response)` `if (!UserLiveFeed_itemsCount[pos] && KickFollow_FeedStart(response)) return;`.
- [ ] **Krok 4:** PASS a všechny harnessy (following-tests: Kick-only větev až za `ScreenObj[key].kickOnlyResponse &&`).
- [ ] **Krok 5: Na TV** (uživatel s Kickem z úlohy 7):
  - Following → Live: Kick karty (ikonka Kick) mezi Twitch kartami podle diváků, Twitch karty s ikonkou Twitche.
  - `ScreenObj[Main_UserLive].data.filter(function (d) { return d.kickCell; }).length` se rovná počtu živých v `curl … v1/user/livestreams`.
  - OK na Kick kartě → hraje.
  - V přehrávači Nahoru → panel obsahuje Kick položky. PiP z panelu na Kick položku funguje (náhrada injekce z úlohy 6).
  - Boční panel (Doleva na obrazovce): Kick položky s ikonkou.
  - Kontrola Review Focus 5: dočasně `AddUser_UsernameArray[0].kick.expired = true; Main_ReloadScreen()` → žádné Kick karty, ikonky na Twitch kartách zmizí. Pak `delete AddUser_UsernameArray[0].kick.expired; AddUser_SaveUserArray()`.
- [ ] **Krok 6:** Commit `Merge followed Kick live streams into Following, player feed and side panel`.

---

### Task 9: Following Kanály s Kick kanály

**Soubory:**
- Upravit:
  - `app/specific/ScreensObj.js`:
    - `ScreensObj_InitUserChannels` :2234 (`concatenate`, větev `dataEnded` před tříděním :2297),
    - `kickOnlyResponse: '{"data":{"currentUser":{"follows":{"edges":[],"pageInfo":{"hasNextPage":false}}}}}'`,
    - `Base_Channel_obj.addCellTemp` :903 (`cell.kickCell ||`, pokud nepřidala úloha 4).
  - `app/specific/KickUser.js`: `KickFollow_Channels`.

**Rozhraní:**
- Poskytuje:
  - `KickFollow_ChannelsStart(key) -> boolean`: projde všechny stránky `https://kick.com/api/v2/channels/followed[?cursor=N]`, dokud `nextCursor` není `null`. Bezpečnostní strop 20 stránek.
  - `KickFollow_ChannelsResult(obj, key, requestId)` (pojmenovaný).
  - `KickFollow_ChannelNodes(channels) -> [{node: {login: slug, id: 'kick:slug', kickCell}}]`.
  - Po dokončení se uzly přidají k `this.data` a pokračuje stávající třídění podle `login` a `loadDataSuccess()`.
- **Decision:** Following Videa zůstávají jen Twitch (spec 2, bod 6). Kick VOD jsou na stránce kanálu.

- [ ] **Krok 1: Padající testy:**
  - Fake obrazovka s Twitch uzly `alpha`, `charlie` a `dataEnded`. Kick strana 1 `{nextCursor: 5, channels: [bravo]}`, pak URL druhého požadavku končí `?cursor=5`. Strana 2 `{nextCursor: null, channels: [delta]}`.
  - Výsledné pořadí `login` = `alpha,bravo,charlie,delta`, `bravo` má `kickCell[19] === 'kick'`.
  - Stale ticket → nic. 401 → Twitch uzly samy a `KickUser_Expired`.
  - Bez tokenu `KickFollow_ChannelsStart` vrací `false` a nic neodejde.
- [ ] **Krok 2:** `node release/scripts/kick-tests.js` → FAIL (`s.KickFollow_ChannelsStart is not a function`).
- [ ] **Krok 3:** Implementace. **Krok 4:** PASS a harnessy.
- [ ] **Krok 5: Na TV:** Following → Kanály obsahuje Kick kanály (ikonka) abecedně mezi Twitch kanály. OK na Kick kanálu → stránka Kick kanálu (úloha 4).
- [ ] **Krok 6:** Commit `Add followed Kick channels to Following channels`.

---

### Task 10: Procházení Kicku – přepínač platformy, Live, kategorie a streamy v kategorii

**Soubory:**
- Vytvořit fixtury: `jsonreferences/kick_browse_livestreams.json`, `kick_categories.json`, `kick_category_livestreams.json`.
- Upravit:
  - `app/specific/KickApi.js`: `KickBrowse_*`.
  - `app/specific/ScreensObj.js`:
    - `ScreensObj_InitLive` :1507 (`set_url`, `concatenate`, přepínač),
    - `ScreensObj_InitGame` :2042 (Kick kategorie),
    - `ScreensObj_InitAGame` :1709 (Kick streamy v kategorii, bez přepínačů videí, klipů a follow pro Kick),
    - `Base_Game_obj.addCell` :804 (větev `cell.kickCell`).
  - Řetězce `STR_PLATFORM = 'Platform'`, `STR_TWITCH = 'Twitch'`, `STR_KICK = 'Kick'`.

**Rozhraní:**
- Poskytuje:
  - `KickBrowse_On() -> Main_getItemBool('kick_browse', false)`.
  - `KickBrowse_Toggle(key)`: uloží, vynuluje `status` obrazovek Live, Games a výsledků vyhledávání, pak `Screens_StartLoad(key)`.
  - `KickBrowse_SwitchLabel() -> STR_PLATFORM + ': ' + (KickBrowse_On() ? STR_KICK : STR_TWITCH)`.
  - `KickApi_GameCell(cat) -> [KickApi_Img(banner), escape(name), viewers text jako Twitch dotaz, 'kick:' + slug]`.
  - Live a Games mají v Kick režimu `isKick = true`, `useHelix = true`, `isQuery = false`, `object = 'data'`. `concatenate` dá `{data: items, pagination: {cursor}}`.
- **Decision:** jeden uložený přepínač pro Live, Hry a výsledky vyhledávání. Formulář vyhledávání se nemění (search-navigation harness). Přepínač je v horní řadě (`HasSwitches`, `addSwitches`, `posY === -1` v `key_play`) na Live a Games. U AGame se Kick kategorie pozná podle `gameSelected_Id` s prefixem `kick:`.

- [ ] **Krok 1: Sonda API (před kódem).**
  - Přečti `KickApiDataSourceImpl.java` v `<scratchpad>\kickapk\full\sources\com\kick\base\data\remote\datasource\api\`:
    - `getLivestreams` (sort, limit, categoryId, languages, cursor), `getFeaturedLivestreams` (`/api/v1/livestreams/featured`, `language`), `getTopCategories` (`/api/v1/categories/top`), `getSubCategories` (`/api/v1/subcategories`, `limit`, `page`), `getSubCategory`,
    - hosty z `AppConfig.java`: `KICK_HOST_SUBDOMAIN_MOBILE = "mobile"`, `_TV = "tv"`, `_SEARCH = "search"`.
  - Ověřeno při plánování:
    - `https://mobile.kick.com/api/v1/livestreams?limit=2&sort=viewer_count_desc` → 200 `{data: {livestreams, pagination}}`,
    - `https://kick.com/api/v1/categories/top` → 200 pole,
    - `https://kick.com/api/v1/subcategories?limit=2&page=1` → 200 stránkovaný objekt,
    - `https://kick.com/api/v1/livestreams` → 404 (na `kick.com` neexistuje).
  - Najdi a ověř curl (desktop UA) parametr kategorie u `livestreams` (název, slug nebo ID), tvar `pagination` / kurzoru a jazyk (`Main_ContentLang`).
  - Ulož fixtury a zapiš přesné cesty do výsledků.
- [ ] **Krok 2: Padající testy:**
  - `KickBrowse_Items(ref('kick_browse_livestreams.json'))` → položky s `kickCell[19] === 'kick'` a kurzor z `pagination`.
  - `KickApi_GameCell(ref('kick_categories.json').data[0])[3] === 'kick:' + slug` a jméno escapované.
  - `set_url` Live v Kick režimu → URL `https://mobile.kick.com/api/v1/livestreams?…` podle sondy (přesný řetězec doplní krok 1), bez Kick tokenu.
  - V Twitch režimu → `this.url` / `this.post` jako dřív (porovnání se snapshotem z původního `set_url`).
  - AGame s `gameSelected_Id = 'kick:irl'` → URL s kategorií a `HasSwitches === false`.
- [ ] **Krok 3:** `node release/scripts/kick-tests.js` → FAIL (`s.KickBrowse_Items is not a function`).
- [ ] **Krok 4:** Implementace. **Krok 5:** PASS a všechny harnessy.
- [ ] **Krok 6: Na TV:**
  - Live → horní řada „Platform: Twitch“, OK → „Platform: Kick“ a Kick top streamy s ikonkou. OK na kartě → hraje.
  - Games → Kick kategorie s bannery, OK → streamy kategorie, OK → hraje.
  - Přepni zpět na Twitch → Twitch obsah jako dřív (screenshot).
- [ ] **Krok 7:** Commit `Browse Kick: platform switch, top live streams, categories and streams in a category`.

---

### Task 11: Vyhledávání na Kicku

**Soubory:**
- Vytvořit fixtury: `jsonreferences/kick_search.json`, `kick_search_categories.json`.
- Upravit:
  - `app/specific/ScreensObj.js`: `ScreensObj_InitSearchChannels` :2329, `ScreensObj_InitSearchLive` :1604, `ScreensObj_InitSearchGames` :2169 (Kick větve podle `KickBrowse_On()`, přepínač v horní řadě jako v úloze 10).
  - `ScreensObj_InitSearchVod`: v Kick režimu prázdný banner s `STR_KICK_NOT_SUPPORTED`.

**Rozhraní:**
- Poskytuje:
  - `KickSearch_Channels(json) -> items`, `KickSearch_Live(json) -> items` (živé kanály z výsledků, jen když odpověď nese livestream), `KickSearch_Categories(json) -> items`.
  - URL podle sondy, `Main_values.Search_data` přes `encodeURIComponent`.
- **Decision:** když Kick nemá vyhledávání živých streamů, SearchLive v Kick režimu vezme kanály z hledání a nechá jen ty s `is_live` / `livestream`. Bez těchto polí ukáže prázdný banner. Rozhodnutí zapiš do výsledků.

- [ ] **Krok 1: Sonda.** `searchEnriched(term, limit)` a `searchCategories(term, limit)` v `KickApiDataSourceImpl.java` (`/api/v1/search/enriched`, `/api/v1/categories/search`).
  - Při plánování: `https://search.kick.com/api/v1/search/enriched?search=xqc&limit=2` → 400, `https://mobile.kick.com/api/v1/categories/search?search=gta&limit=2` → 400 (špatné jméno parametru nebo host).
  - Najdi správné jméno parametru (pravděpodobně jiný klíč než `search`, ověř v dekompilovaném kódu, který string se připojuje k URL) a host. Ulož fixtury.
  - Když vyhledávání nejde rozchodit do 30 minut, zaparkuj úlohu (výsledky: status a tělo) a pokračuj úlohou 12.
- [ ] **Krok 2: Padající testy:** převod fixtur na položky (kanál: `kickCell[1] === 'kick:' + slug`, escapované jméno), URL s `encodeURIComponent('a b&c')` = `a%20b%26c`, Twitch režim beze změny.
- [ ] **Krok 3:** `node release/scripts/kick-tests.js` → FAIL (`s.KickSearch_Channels is not a function`).
- [ ] **Krok 4:** Implementace. **Krok 5:** PASS a harnessy (search-navigation zelený).
- [ ] **Krok 6: Na TV:** Vyhledávání `xqc` → Kanály s přepínačem, Kick → Kick kanál `xqc` s ikonkou, OK → stránka kanálu. Kategorie `gta` → Kick kategorie. Živé dle rozhodnutí.
- [ ] **Krok 7:** Commit `Search Kick channels, live streams and categories`.

---

### Task 12: Sledování a odsledování Kick kanálu

**Soubory:**
- Upravit:
  - `app/specific/AddCode.js`: `AddCode_CheckFollow` :244, `AddCode_Follow` :293, `AddCode_UnFollow` :331 (Kick větev podle `KickApi_IsKickId(AddCode_Channel_id)`).
  - `app/specific/Screens.js`: `Screens_ThumbOption_RequestCheckFollow` :3433, `Screens_FollowUnfollow` :4040 (Kick větev).
  - `app/specific/ChannelContent.js`: `ChannelContent_keyEnter` :436 (follow vyžaduje `KickUser_Token()` místo Twitch tokenu).
  - `app/specific/PlayEtc.js`: `Play_controlsFollow.enterKey` :2273 (stejně).
  - `app/specific/KickUser.js`: `KickFollow_State`, `KickFollow_Set`.

**Rozhraní:**
- Poskytuje:
  - `KickFollow_Set(slug, follow, done)`: `POST` (follow) / `DELETE` (unfollow) `https://kick.com/api/v2/channels/<slug>/follow` s Bearer. Výsledek do pojmenovaného `KickFollow_SetResult(obj, key, seq)`. 2xx → nový stav, 401 → `KickUser_Expired()`.
  - `KickFollow_Check(slug, done)` podle sondy.
  - Výsledky volají stávající `AddCode_RequestCheckFollowOK/Error`, `AddCode_FollowSucess`-ekvivalent (nastaví `AddCode_IsFollowing` a `Play_setFollow` / `ChannelContent_setFollow`) a `Screens_ThumbOption_RequestCheckFollowEnd` / `Screens_FollowRequestEnd`.
- **Decision:** stav sledování buď z endpointu nalezeného sondou, nebo (záloha) z cache `v2/channels/followed` (všechny stránky jako v úloze 9, platnost 5 minut, po follow/unfollow se upraví lokálně).

- [ ] **Krok 1: Sonda** (bez změn na účtu, dokud není jasné, že jde vrátit):
  - `getChannelMe` v dekompilátu (`/api/v1/channels/<slug>/me`) vrátil při plánování s tokenem `404 {"message":""}`. Ověř jiné hosty (`mobile.kick.com`), `v2/channels/<slug>/me` a pole o sledování v odpovědi.
  - Follow: POST `v2/channels/<malý testovací kanál>/follow` s tokenem, ověř 200 a stav ve `v2/channels/followed`, pak DELETE a znovu ověř, že účet je jako předtím. Zapiš do výsledků.
- [ ] **Krok 2: Padající testy:**
  - `AddCode_Channel_id = 'kick:xqc'` → `AddCode_Follow()` → požadavek `POST https://kick.com/api/v2/channels/xqc/follow` s Bearer Kick tokenem a bez `Client-ID`.
  - Twitch ID → GQL jako dřív.
  - Výsledek 200 → `AddCode_IsFollowing === true` a `Play_setFollow` voláno (při `AddCode_PlayRequest`). 401 → `KickUser_Expired`.
  - `Screens_FollowUnfollow` s Kick kartou → `DELETE`, když `Screens_isFollowing`.
  - Bez Kick tokenu → `Main_showWarningDialog(STR_NOKEY_WARN…)` a nic neodejde.
- [ ] **Krok 3:** `node release/scripts/kick-tests.js` → FAIL (požadavek jde na `https://gql.twitch.tv/gql`).
- [ ] **Krok 4:** Implementace. **Krok 5:** PASS a harnessy.
- [ ] **Krok 6: Na TV** (kanál, který uživatel nesleduje, vybraný v kroku 1):
  - Stránka kanálu → „Follow“ → „Following“ a kanál je v `curl … v2/channels/followed`.
  - Znovu → „Follow“ a kanál zmizí. Totéž z ovládání přehrávače.
  - Konečný stav sledování musí být jako před testem.
- [ ] **Krok 7:** Commit `Follow and unfollow Kick channels from the player, channel page and thumbnail options`.

---

### Task 13: Psaní do Kick chatu

**Soubory:**
- Upravit:
  - `app/specific/ChatLive.js`: `ChatLive_SendMessage` :1702 (Kick větev).
  - `app/specific/PlayEtc.js`: `Play_controlsChatSend.enterKey` :2985 (Kick chat vyžaduje `KickUser_Token()`, Twitch beze změny).
  - `app/specific/ChatLiveControls.js`: `ChatLiveControls_CanSend` :796 (Kick: jen token a chatroom, Twitch room state se nepoužije).
  - `app/specific/KickUser.js`: `KickChat_Send`.

**Rozhraní:**
- Poskytuje:
  - `KickChat_Send(chat_number, text) -> boolean`: `false` bez tokenu nebo `ChatKick_State[chat_number].chatroom`. Jinak `POST https://kick.com/api/v2/messages/send/<chatroom>` s Bearer, `Content-Type: application/json`, tělem podle sondy (výchozí `{"content": text, "type": "message"}`), callback `KickChat_SendResult(obj, key, seq)`.
  - Chyba → `ChatLiveControls_showWarningDialog(STR_KICK_CHAT_SEND_FAIL, 2000)`, 401 → `KickUser_Expired`.
  - Odeslaná zpráva se nevkládá lokálně, přijde přes Pusher.
  - `STR_KICK_CHAT_SEND_FAIL = 'Message not sent to Kick chat'`.
- **Decision:** výběr emotů (`ChatLiveControls_ShowEmotes`) zůstává Twitch. V Kick chatu vložený kód emotu odejde jako text.

- [ ] **Krok 1: Sonda:** `sendMessage(chatroomId, message)` v `KickApiDataSourceImpl.java` (:5518, cesta `/api/v2/messages/send/`), zjisti tělo (serializace `SendChannelMessage…`). Ověř jednou curl zprávou do vlastního Kick chatu uživatele (`https://kick.com/<username uživatele>`, ne do cizího kanálu).
- [ ] **Krok 2: Padající testy:**
  - `ChatLive_SendMessage('hi', 0)` s Kick chatem (`ChatLive_selectedChannel_id[0] = 'kick:x'`, `ChatKick_State[0] = {chatroom: 32806}`) → `POST https://kick.com/api/v2/messages/send/32806`, tělo `{"content":"hi","type":"message"}`, Bearer Kick tokenu. Vrací `true`.
  - Bez chatroom → `false` a nic neodejde. Twitch chat → `ChatLive_socketSend.send` jako dřív.
- [ ] **Krok 3:** `node release/scripts/kick-tests.js` → FAIL (zpráva odejde do Twitch IRC, `POST` chybí).
- [ ] **Krok 4:** Implementace. **Krok 5:** PASS a harnessy (chat-optimization: stub `KickChat_Send`).
- [ ] **Krok 6: Na TV:** Otevři vlastní Kick kanál uživatele (offline stránka kanálu → Enter = chat offline). Ovládání „Write in chat“, napiš `test` → zpráva se objeví v chatu přes Pusher do 5 s. Zapiš do výsledků.
- [ ] **Krok 7:** Commit `Send messages to Kick chat`.

---

### Task 14: Akceptace na TV, debug APK a předání

Bez nového kódu (jen opravy nalezených chyb s testem a vlastním commitem).

**Soubory:** `docs/kick-implementation-results.md`, případně `docs/kick-design.md` oddíl 8 (věta s odkazem na výsledky).

- [ ] **Krok 1:** Všechny harnessy a `node release/scripts/maker.js jsh` → zelené. Pak `node release/scripts/maker.js` (plná sestava) → bez chyb. Vygenerované soubory se necommitují: `git checkout -- release/ apk/Changelog_Up.md` a `git status` čistý kromě docs.
- [ ] **Krok 2:** Sestav a nainstaluj debug APK s posledním stavem (postup v Global Constraints) a nech ho na TV.
- [ ] **Krok 3: Akceptace podle specu 7.** Každý bod jako prošlo / neprošlo / zaparkováno s důvodem do výsledků:
  - **Základ:** Kick live z Following, kvality, nízká latence, reconnect (`Play_loadData()`), Twitch beze změny.
  - **A:**
    - Kick VOD s posunem a pokračováním, klip, stránka kanálu,
    - Kick chat s historií, připojený Twitch a YouTube, Linked chats, VOD bez chatu,
    - 50/50, PiP a čtyři streamy Twitch/Kick, Kick/Kick i Kick/Twitch,
    - historie s Kick položkami.
  - **B:** Kick uživatel (token), Following Live, Kanály, panel, boční panel, „sign in again“ po ruční simulaci `kick.expired`, záloha (jen kontrola `AddUser_UsernameArray` obsahu po `GDriveBackup` bez Google účtu = zaparkovat).
  - **C:** přepínač, Live, kategorie, vyhledávání.
  - **D:** follow/unfollow (stav jako předtím), psaní do chatu.
- [ ] **Krok 4:** TV vrátit: `adb -s <IP TV>:5555 shell settings put secure sleep_timeout 1800000` a `… put system screen_off_timeout 600000` (nebo hodnoty poznamenané na začátku).
- [ ] **Krok 5: Souhrn pro uživatele** do výsledků (horní oddíl „Ráno“):
  - co je hotové, co zaparkované a proč, rozhodnutí přijatá v noci (odkaz na „Decision“ řádky plánu a nové),
  - **ranní kontrola s uživatelem:** QR přihlášení telefonem (nový Kick uživatel i připojení k LordBoos), vzhled ikonek, vydání až po souhlasu (zvýšení `WebTag`, changelog, plná sestava, push).
- [ ] **Krok 6:** Commit `Record Kick acceptance results on the TV`.
