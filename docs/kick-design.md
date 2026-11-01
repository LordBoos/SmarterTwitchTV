# Kick jako druhá platforma – design

Sepsáno 1. 11. 2026 pro Smarter Purple TV (SPTV). Druhá fáze po sloučeném chatu (`docs/unitychat-design.md`). Dokument říká **co** a **proč**, implementační plán je `docs/kick-implementation-plan.md`.

## 1. Proč a co

Uživatel sleduje streamery na Twitchi i na Kicku a chce v aplikaci všechno, co dnes umí s Twitchem, i s Kickem (jeho slova):

> zapnu aplikaci, ta zobrazí účty, vyberu například můj Twitch účet LordBoos a k němu budu mít připojený i můj Kick účet LordBoos, přejdu na kartu Following a tam uvidím streamy, které jsou live jak z Twitche, tak z Kicku a budou rozlišené ikonkami platforem. Otevřu třeba Kick stream a sleduji ho stejně jako bych otevřel současný Twitch stream. Prostě vše co máme pro Twitch, ale s Kickem – streamy, VODs, 50/50 sledování dvou streamů současně (může to být Twitch/Twitch, Kick/Kick, ale i kombinace jako Kick/Twitch).

Dále: možnost přidat i **samostatný** Kick účet, nejen připojený k Twitchi. U Kick streamu je **hlavní chat Kick** a Twitch a YouTube jde připojit (obrácená verze první fáze).

## 2. Rozhodnutí

### Uživatel
1. Přihlášení na Kick „variantou B“: neoficiální webová session Kicku, **automaticky přes QR** stejně jako oficiální TV aplikace Kicku (viz 4.1). Žádné kopírování tokenu z prohlížeče.
2. Samostatný Kick uživatel i Kick účet připojený k Twitch uživateli.
3. Postup **postupně** (ne paralelní agenti), práce běží **přes noc bez zásahů uživatele**. Otázky jen na začátku, výsledek ráno.
4. Body 1–15 níže uživatel přijal tak, jak je navrhl autor (neodpověděl jinak).

### Návrhy autora přijaté uživatelem (body 1–15)
1. **Účty:** v seznamu uživatelů jde přidat samostatného Kick uživatele. K existujícímu Twitch uživateli jde ve volbách uživatele připojit Kick účet. Přihlášení QR.
2. **Vypršení Kick session:** obnova neexistuje. Když Kick token odmítne (401), aplikace ukáže „přihlas se znovu“ s QR.
3. **Záloha na Google Drive** zahrnuje i Kick přihlášení (jako Twitch token).
4. **Streamer sledovaný na obou platformách a živý na obou:** dvě samostatné karty (Twitch a Kick).
5. **Following Live:** živé streamy obou platforem v jednom seznamu, řazené stávajícím nastavením řazení (výchozí počet diváků), na každé kartě ikonka platformy.
6. **Following Kanály** obsahuje i Kick kanály. **Following Videa** zůstává jen Twitch (Kick nemá souhrnný seznam videí sledovaných), Kick VOD jsou na stránce kanálu. Sledované kategorie Kicku vynechány.
7. **Panel živých streamů v přehrávači** (výběr pro 50/50 a čtyři streamy, boční panel) obsahuje i Kick.
8. **Kick živé streamy:** kvality a nízká latence jako Twitch. **Kick VOD** s posunem a pamatováním pozice v historii. **Klipy** na stránce kanálu.
9. **Chat ke Kick VOD:** ne, zobrazí se „chat není k dispozici“.
10. **Chat u Kick streamu:** hlavní Kick (existující `ChatKick.js`), Twitch (jen čtení, anonymní IRC) a YouTube se připojí přes adresář UnityChatu (`platform=kick&handle=<slug>`) nebo dialog „Linked chats“, propojení se ukládá u Kick kanálu. Ikonky, odznaky, historie jako v první fázi.
11. **Historie sledování** obsahuje i Kick streamy a VOD s ikonkou.
12. **Procházení:** v obrazovkách Live, Hry (kategorie) a Vyhledávání přepínač Twitch / Kick.
13. **Doplňky:** sledování / odsledování na Kicku a psaní do Kick chatu ano. Upozornění na začátek vysílání Kick až příště (změny v Javě).
14. **Větev `feature/kick`**, přes noc nic nepushnout, nevydávat, neslučovat do `master`. Ráno souhrn a debug APK na TV, vydání po souhlasu uživatele.
15. **Testy na TV** dělá agent sám přes adb a DevTools (CDP), Kick přihlášení z uloženého tokenu. Neřešitelná překážka se zaparkuje s popisem a pokračuje se dalším projektem. Pořadí: Základ → A → B → C → D.

## 3. Mimo rozsah

- Upozornění na začátek vysílání Kick (Java `NotificationUtils`), kanály na domovské obrazovce Android TV pro Kick.
- Přehrávání chatu z minulosti u Kick VOD.
- Sledované kategorie Kicku, souhrnný seznam videí sledovaných Kick kanálů.
- Telefonní chat pro Kick streamy (`app/PhoneChat/`).
- Raidy / hostování na Kicku, EventSub obdoby.
- Změny Java přehrávače, pokud nebudou nutné (podle průzkumu nejsou).

## 4. Ověřená fakta o Kicku (1. 11. 2026)

Všechno je **neoficiální interní API** webu a aplikací Kicku. Může se změnit. Kick filtruje požadavky podle otisku TLS: Node `fetch` dostal `403 {"error":"Request blocked by security policy."}`, curl, Python a Java `HttpURLConnection` (nativní `FullxmlHttpGet` v APK) prošly. Kick posílá CORS a zrcadlí origin (`access-control-allow-origin: https://lordboos.github.io`, `allow-credentials: true`), ale **přihlášená volání posílat nativně** (`FullxmlHttpGet` s hlavičkou `Authorization`). Desktopový User-Agent pomáhá.

### 4.1 QR přihlášení (z oficiální aplikace `com.kick.mobile` 1.9.0, ověřeno end-to-end)
1. TV vygeneruje `uuid` = náhodné UUID **velkými písmeny** a `key` = **6 náhodných číslic**.
2. TV ukáže QR s textem `https://kick.com/tv/login?uuid=<UUID>&code=<KEY>`. Webová stránka na této adrese neexistuje (404), odkaz otevírá **mobilní aplikace Kick** (app link), kde uživatel přihlášení potvrdí. Bez `&code=` aplikace ukáže „Režim TV“ a vrátí se na úvod.
3. TV se přihlásí k Pusher kanálu `tv-setup-<UUID>` (key `34bf7a0ff419a2a775b9`, cluster `us2`, stejné jako chat) a čeká na událost `App\Events\SetupTvEvent` (data `[]`).
4. Pak (nebo průběžně každé ~3 s jako záloha) `POST https://kick.com/api/tv/link/authenticate/<UUID>` s tělem `{"key":"<KEY>"}` a `Content-Type: application/json`:
   - před potvrzením `403 {"message":"Invalid setup UUID and Key"}`,
   - po potvrzení `200 {"token":"<id>|<random>"}` (50 znaků).
5. `token` je session Kicku. Posílá se jako `Authorization: Bearer <token>`. Jako cookie nefunguje. Doba platnosti neznámá, obnova neexistuje.

### 4.2 Endpointy s tokenem (ověřeno 200)
- `GET https://kick.com/api/v1/user` → `{id, username, …}` (obsahuje i e-mail, neukládat ho).
- `GET https://kick.com/api/v2/channels/followed[?cursor=N]` → `{nextCursor, channels:[{channel_slug, user_username, profile_picture, is_live, viewer_count, category_name, session_title, …}]}`.
- `GET https://kick.com/api/v1/user/livestreams` → pole živých sledovaných: `{id, slug, channel_id, session_title, viewer_count, start_time, language, is_mature, thumbnail:{src, srcset}, categories:[{name, …}], channel:{id, user_id, slug, playback_url, user:{username, profilepic}}}`. **Obsahuje přímo `playback_url`.**
- Neověřeno (bez změn na účtu): `POST|DELETE https://kick.com/api/v2/channels/<slug>/follow` (bez tokenu 401, GET 405), odesílání chatu `POST https://kick.com/api/v2/messages/send/<chatroomId>` (používá UnityChat).

### 4.3 Endpointy bez přihlášení (ověřeno 200)
- `GET https://kick.com/api/v2/channels/<slug>` → `id` (kanál), `user_id`, `chatroom.id`, `playback_url`, `user{username, profile_pic}`, `livestream` (null offline, jinak `id, session_title, viewer_count, language, is_mature, start_time, thumbnail, categories`), `subscriber_badges`. Tři různá ID: kanál, uživatel, chatroom.
- **Živé HLS:** `playback_url` je AWS IVS master (`*.playback.live-video.net/...m3u8?token=<JWT>`), JWT `exp` ~10 min → při reconnectu znovu načíst kanál. Rendice 1080p60/720p60/480p30/360p30/160p30, H.264 + AAC, titulky jako `EXT-X-MEDIA TYPE=SUBTITLES`, bez reklam (`aws:ads-opt-out:true`). Master i media playlist jdou stáhnout bez hlaviček.
- **VOD:** `GET https://kick.com/api/v2/channels/<slug>/videos` → pole (`id, session_title, start_time, duration` ms, `source` (základ URL), `views, thumbnail.src, categories, video{uuid, …}`). Přehrání: `<source>media/hls/master.m3u8` (bez `media/hls/` 403). Detail `GET https://kick.com/api/v1/video/<uuid>`.
- **Klipy:** `GET https://kick.com/api/v2/channels/<slug>/clips` → `{clips:[{id, title, clip_url (m3u8), thumbnail_url, video_url, duration, views, created_at}]}`.
- **Kategorie:** `GET https://kick.com/api/v1/subcategories?limit=N` (`id, name, slug, viewers, banner.responsive`).
- **Vyhledávání, top živé streamy, top kategorie:** oficiální aplikace volá `/api/v1/livestreams` (sort, limit, category, languages, cursor), `/api/v1/livestreams/featured`, `/api/v1/categories/top`, `/api/v1/categories/search`, „searchEnriched“ (term). Přesné cesty a parametry nejsou ověřené. Dekompilovaná aplikace je v `<scratchpad>\kickapk\full\sources` (třída `com/kick/base/data/remote/datasource/api/KickApiDataSourceImpl.java`).
- **UnityChat adresář:** `GET https://api.jouki.cz/streamers/lookup?platform=kick&handle=<slug>` (stejný tvar jako pro Twitch).

## 5. Jak je dnes Twitch zabudovaný v aplikaci (průzkum kódu)

- **Uživatel** (`AddUser_UsernameArray`, `AddUser.js:22`, ukládá se do localStorage `AddUser_UsernameArrayNew`, záloha slučuje podle `id`): `{name, id, display_name, logo, access_token, date, refresh_token:0, expires_in:0, expires_when:0, timeout_id}`. Přihlášení Twitch device code. Vše je klíčované `AddUser_UsernameArray[0].id` (historie, blokované, navigace). Obnova tokenu neexistuje.
- **Datový řádek streamu** (`ScreensObj_LiveCellArray`, `ScreensObj.js:3043`, 19 pozic, VOD `:3067`, klip `:3111`) **nemá pole platformy** a na ~10 místech se znovu skládá z Twitch Helix (`Play.js:577,752`, `PlayMulti.js:50`, `Sidepannel.js:198`, `UserLiveFeed.js:1358`, `ScreensObj.js:3385`, `PlayRaid.js:297`, `Main.js:2838,3437`, `ChannelContent.js:283`). Klíčové pozice: `[0]` náhled s `{width}x{height}`, `[1]` jméno, `[2]` titulek, `[3]` hra, `[4]` diváci text, `[6]` login (pro usher a IRC), `[7]` broadcast id (klíč historie), `[13]` diváci číslo, `[14]` user_id (chat, follow, info, blokace, dedup).
- **Following Live** (`ScreensObj_InitUserLive`, Helix `streams/followed`, stránkování kurzorem, bez řazení na klientu) a **panel v přehrávači** (`UserLiveFeedobj`, GQL `followedLiveUsers`, řazení `UserLiveFeedobj_FeedSort` podle nastavení).
- **Otevření streamu:** karta → `Main_OpenLiveStream` → `Play_Start` → `Play_loadData` → **`PlayHLS_GetPlayListAsync(isLive, login, …)`** (9 volajících, synchronní dvojče `PlayHLS_GetPlayListSync`) → `{status, url, responseText, checkResult}` → `OSInterface_StartAuto(url, playlist, type, resume, slot)` (type 1 živé HLS, 2 VOD HLS, 3 klip MP4). Java přehrávač je obecný HLS, reklamní filtr je jen pro `*.ttvnw.net`. 50/50, PiP i čtyři streamy jdou stejnou cestou (`StartAuto` slot 1, `StartMultiStream`).
- **Twitch-only volání během přehrávání:** info o streamu `helix/streams?user_id=[14]`, logo `helix/users`, VOD živého, follow check, raid EventSub, `Play_StayCheckLive`.
- **Chat:** `ChatLive_Init` otevírá Twitch IRC podle `[14]`/`[6]` a pak `ChatMulti_Start`. `ChatKick_Start(chat_number, seq, slug, withHistory)` už existuje.
- **Ikonka platformy:** `ChatMulti_Icon(platform)` a CSS `.chat_pi_tw|yt|kick` (`index.html`).

## 6. Architektonická rozhodnutí (autor)

- **Platforma v datovém řádku:** nová pozice `[19]` = `'kick'` u Kick řádků, u Twitch `undefined`/`'tw'`. Kick řádky se plní tak, aby stávající kód karet fungoval: `[0]` náhled (pevná URL, `replace('{width}x{height}')` nic nezmění), `[1]` jméno, `[2]` titulek, `[3]` kategorie, `[4]`/`[13]` diváci, `[6]` **slug**, `[7]` id livestreamu/VOD, `[14]` **`kick:<id kanálu>`** (prefix brání kolizím s Twitch ID v dedupu, historii a blokacích), `[9]` avatar.
- **Kick API modul** (`app/specific/Kick*.js`): jedno místo pro volání s desktopovým UA a volitelným Bearer tokenem, přes `FullxmlHttpGet` (pojmenované callbacky, `null, null` pro GET), převod odpovědí na řádky.
- **Playlist:** `PlayHLS_GetPlayListAsync` / `Sync` dostanou větev pro Kick (podle `[19]`): načte kanál (živé) nebo použije `source` (VOD), stáhne master text a vrátí stejný tvar výsledku. Při reconnectu se kanál načte znovu (expirace JWT).
- **Twitch-only volání během přehrávání** se pro Kick přeskočí nebo nahradí Kick obdobou (info o streamu z `v2/channels/<slug>`).
- **Uživatel:** propojený Kick účet jako `kick: {id, username, logo, token, date}` uvnitř Twitch uživatele. Samostatný Kick uživatel jako položka s `platform: 'kick'` a `id: 'kick:<id>'`. Kód, který potřebuje Twitch token, se u Kick-only uživatele chová jako bez přihlášení k Twitchi.
- **Chat:** pro Kick řádek `ChatLive_Init` neotevírá Twitch IRC, hlavní zdroj je Kick (`ChatKick` s historií), ikonky a linky přes `ChatLink` klíčované i platformou (`kick:<slug>`), Twitch se připojí anonymním IRC jen pro čtení.
- **Žádné změny Javy**, pokud se neukáže nutnost. Případná změna Javy znamená nové APK (uživatel souhlasí).

## 7. Projekty a akceptační kritéria

### Základ
- Platforma v řádku, Kick API modul, Kick větev playlistu, ikonka platformy na kartách (`Screens.js`, `UserLiveFeedobj.js`, boční panel).
- Otevření Kick živého streamu podle slugu odkudkoli (dočasně z ladicího volání), přehrání, kvality, nízká latence, reconnect s novým tokenem.
- Twitch chování beze změny (všechny stávající harnessy zelené).

### A) Přehrávání a chat
- Kick VOD (posun, pozice v historii), klipy, stránka Kick kanálu (živé, videa, klipy).
- Kick hlavní chat (živě i s historií), připojitelný Twitch (anonymní IRC, jen čtení) a YouTube, „Linked chats“ pro Kick kanál, chat u Kick VOD vypnutý s hláškou.
- 50/50, PiP a čtyři streamy v libovolné kombinaci Twitch/Kick, včetně panelu živých streamů v přehrávači (zatím se Kick položky do panelu dostanou až s B, pro test A stačí ladicí otevření).
- Historie sledování s Kick položkami a ikonkou.

### B) Kick účty a Following
- QR přihlášení (4.1) jako dialog s QR (vzor `PhoneChat_DrawQr`), samostatný Kick uživatel a připojení k Twitch uživateli, odhlášení, „přihlas se znovu“ při 401.
- Following Live: sloučené živé streamy (Twitch Helix + `v1/user/livestreams`), řazení podle nastavení, ikonky. Following Kanály s Kick kanály. Panel živých streamů v přehrávači a boční panel s Kick.
- Záloha na Google Drive zahrnuje Kick údaje.

### C) Procházení a vyhledávání
- Přepínač Twitch / Kick v Live, Hry (kategorie) a Vyhledávání. Kick top živé streamy, kategorie a streamy v kategorii, vyhledávání kanálů (cesty ověřit v dekompilované aplikaci).

### D) Doplňky
- Sledovat / odsledovat Kick kanál (z přehrávače a stránky kanálu), psaní do Kick chatu (stávající UI pro psaní do chatu), obojí s tokenem.

## 8. Ověření

- Harness `release/scripts/kick-tests.js` (vm sandbox, styl stávajících) s reálnými fixtures v `jsonreferences/kick_*.json` (doplnit `kick_user_livestreams.json`, `kick_followed.json`, `kick_videos.json`, `kick_clips.json` bez osobních údajů a tokenů).
- Všechny stávající harnessy a `node release/scripts/maker.js jsh` zelené po každém úkolu.
- **Na zařízení** (Sony BRAVIA, `adb connect <IP TV>:5555`, debug `com.fgl27.twitch.debug`, CDP přes `adb forward … webview_devtools_remote_<pid>`): otevření Kick živého streamu a VOD, kvality, Kick chat, smíšené 50/50, Following se sloučenými streamy (Kick token z `~/.claude/state/kick-tvlink-token.json` vložit do debug aplikace přes CDP, QR přihlášení ověřit ráno s uživatelem).
- Debug APK s webem v assets: `release/scripts/up_assets.sh`, `apk/gradlew.bat assembleDebug`, `adb install -r` (zachová přihlášení), `up_assets.sh 1`.
- Výsledky akceptace na TV a ranní souhrn jsou v `docs/kick-implementation-results.md`.

## 9. Provoz přes noc

- Nic nepushnout, nevydat, nesloučit. Commity jen na `feature/kick`.
- TV: `sleep_timeout` a `screen_off_timeout` dočasně vypnuté (původně `1800000` a `600000`), ráno vrátit.
- Ráno: souhrn pro uživatele (co hotovo, co zaparkováno a proč, rozhodnutí přijatá v noci), debug APK s posledním stavem na TV.
