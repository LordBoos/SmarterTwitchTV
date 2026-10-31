# Sloučený chat z YouTube a Kicku – implementační plán

> **Pro agentní implementaci:** POVINNÝ SUB-SKILL: použij superpowers:subagent-driven-development (doporučeno) nebo superpowers:executing-plans a plň plán po úlohách. Kroky mají zaškrtávací syntaxi (`- [ ]`).

**Cíl:** Do Twitch chatu v přehrávači SPTV přidat živé i historické zprávy z YouTube a Kicku téhož streamera, s ikonkou platformy, odznaky, barvami a zvláštními řádky (Super Chat, členství, suby). Propojení kanálů se bere z adresáře UnityChatu a jde ručně přepsat v dialogu přehrávače. Vydává se nové APK a webová verze.

**Architektura:** Čtyři nové ES5 soubory v `app/specific/`:
- `ChatLink.js`: propojení kanálů, úložiště a adresář,
- `ChatMulti.js`: společné vykreslení řádku a životní cyklus,
- `ChatKick.js`: Kick přes XHR a Pusher websocket,
- `ChatYouTube.js`: YouTube přes nativní `FullxmlHttpGet` a polling innertube.

K tomu `ChatLinkDialog.js` (dialog v přehrávači). Cizí zprávy jdou stejnou cestou jako Twitch: `ChatLive_LineAddCheckDelay`. Ikonky se přepínají třídou `chat_linked` na boxu chatu (CSS), bez procházení DOM.

**Tech stack:** vanilla ES5 (staré TV WebView), JSHint, Node harness ve `vm` sandboxu (vzor `release/scripts/chat-optimization-tests.js`), Android Gradle (APK).

**Spec:** `docs/unitychat-design.md` (schváleno uživatelem 31. 10. 2026). Kdo plní úlohu, čte plán i spec.

## Global Constraints

- **ES5:** bez arrow funkcí, `let/const`, `class`, template literals, `fetch` a `Array.prototype.includes`. Musí projít `node release/scripts/maker.js jsh`.
- **Prettier** podle `.prettierrc`: 4 mezery, šířka 150, jednoduché uvozovky, bez trailing comma.
- **Callbacky `FullxmlHttpGet`** musí být pojmenované top-level funkce, protože se volají přes `callbackSuccess.name`. Callback dostane `(obj, key, checkResult)` a `obj = {status, responseText}`. `key` = `chat_number`, `checkResult` = `Chat_Id[chat_number]` (čísla). Síťová chyba = `status: 0`.
- **Generace:** každá asynchronní odpověď a timer začíná `if (id !== Chat_Id[chat_number]) return;`.
- **Nedůvěryhodný vstup:** jména, text, barvy, ID a URL z YouTube, Kicku i adresáře jsou nedůvěryhodné.
  - Jména escapovat přes `Screens_AriaEscape`.
  - Text jen přes `ChatLive_extraMessageTokenize`, ten escapuje přes `twemoji.parse`.
  - Barva jen `/^#[0-9a-f]{6}$/i`.
  - ID do atributů jen `[\w-]`.
  - URL obrázků jen `https://` z povolených hostů.
  - Nikdy nepoužívat `ChatLive_loadChatSuccess` pro cizí zprávy.
- **YouTube požadavky** mají hlavičky `[['User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'], ['Cookie', 'SOCS=CAI']]`.
- **Na `api.jouki.cz`** se volají jen `GET /streamers/lookup` a `GET /kick/realtime`. Nic se tam neposílá.
- **Výpadek YouTube, Kicku nebo adresáře je tichý:** žádný řádek s chybou v chatu, žádný dialog. Twitch chat ani přehrávání se nesmí změnit.
- **Texty:** nikde em dash (U+2014), jen en dash `–` (U+2013). Platí i pro komentáře v kódu a commit messages. Komentáře v kódu anglicky, jako zbytek repozitáře.
- **Commity:** anglicky, ve stylu historie repozitáře, **bez** řádků `Co-Authored-By` a `Claude-Session`. Práce na větvi `feature/unitychat`. Push a zveřejnění APK jen se souhlasem uživatele.
- **`release/` se ručně needituje**, regeneruje se jen přes `node release/scripts/maker.js`.
- **Nové soubory** se přidají i do bloku `jsstart … jsend` v `app/index.html`, mezi `specific/ChatLive.js` a `specific/ChatLiveControls.js`.

## Review Focus

1. **XSS přes cizí data:** může jít o jméno `"><img src=x onerror=alert(1)>`, o text se `<script>`, o barvu `red;background:url(x)`, o emoji nebo odznak z cizího hostu nebo o ID s mezerou a uvozovkou. Očekávané chování: vše escapované nebo zahozené, v HTML není žádný nový tag ani atribut. Testy jsou v úlohách 3, 4 a 5.
2. **Zastaralá odpověď po přepnutí kanálu** (multistream, prohození PiP přes `ChatLive_Switch`, zavření přehrávače): zahodí se a starý websocket ani polling dál neběží. Testy jsou v úlohách 3, 4 a 5.
3. **Reconnect Twitch IRC** (`ChatLive_Check` → `ChatLive_Close`) **nesmí zastavit** YouTube ani Kick. Zastavuje je jen `ChatLive_Clear`. Test je v úloze 3.
4. **Adresář nedostupný** (timeout, 500, `status: 0`): ruční propojení funguje dál, v chatu se neobjeví žádná chyba a chyba se necachuje, takže příští otevření to zkusí znovu. Test je v úloze 2.
5. **Pozdní historie:** historie YouTube nebo Kicku dorazí až po prvních živých zprávách. Vloží se mezi řádky historie podle času, ne za živé řádky, a zpráva přítomná v historii i živě se zobrazí jednou. Testy jsou v úloze 3.

---

### Úloha 1: Prostředí pro APK a ověření na zařízení (go/no-go)

Bez kódu aplikace. Výsledkem je funkční debug APK na TV, ověřená síťová volání a reálné vzorky dat pro testy.

**Soubory:**
- Vytvořit:
  - `jsonreferences/kick_channel.json`,
  - `jsonreferences/kick_history.json`,
  - `jsonreferences/kick_pusher_events.json` (pole zachycených Pusher zpráv),
  - `jsonreferences/youtube_chat_initial_actions.json` (jen `contents.liveChatRenderer.actions` z `ytInitialData`),
  - `jsonreferences/youtube_get_live_chat.json` (2–3 odpovědi pollingu).
- Upravit: `docs/unitychat-design.md` (oddíl 10, výsledek ověření).

- [ ] **Krok 1: Větev a commit specu**

```bash
git checkout -b feature/unitychat
git add docs/unitychat-design.md docs/unitychat-implementation-plan.md
git commit -m "Add design and implementation plan for merged YouTube and Kick chat"
```

- [ ] **Krok 2: Android SDK a media.** Na stroji není Android SDK ani Android Studio a chybí sourozenecká složka `media`. `apk/settings.gradle` čte `$rootDir/../../media`, tedy `E:\Projects\Private\SmarterTwitchTV\media`.
  - **Před instalací se zeptej uživatele.** Jde o stovky MB.
  - Nainstaluj Android Studio, nebo command-line tools s `platforms;android-35`, `build-tools;35.0.0` a `platform-tools`.
  - Vytvoř `apk/local.properties` se `sdk.dir=…`. Soubor necommituj, je v `.gitignore`. Pokud tam není, přidej ho.
  - Naklonuj `git clone https://github.com/fgl27/media E:/Projects/Private/SmarterTwitchTV/media`.

- [ ] **Krok 3: Debug APK se zabaleným webem**

```bash
bash release/scripts/up_assets.sh
cd apk && ./gradlew assembleDebug
```

Očekávání: `BUILD SUCCESSFUL` a soubor `apk/app/build/outputs/apk/debug/*.apk`.

- [ ] **Krok 4: Instalace na TV.** Uživatel na TV zapne vývojářský režim a ladění přes síť a sdělí IP adresu.

```bash
adb connect <ip-tv>:5555
adb install -r apk/app/build/outputs/apk/debug/<soubor>.apk
```

Debug build má `WebView.setWebContentsDebuggingEnabled(true)` (`PlayerActivity.java:1897`), takže jde ladit přes `chrome://inspect` v Chrome na PC.

- [ ] **Krok 5: Sonda v konzoli WebView** (`chrome://inspect`, aplikace běží). Do konzole se vloží dočasné globální callbacky (`function ProbeOk(o,k,c){console.log(o.status,o.responseText.length);window.probe=o;}`) a postupně se volá:
  1. `FullxmlHttpGet('https://api.jouki.cz/streamers/lookup?platform=twitch&handle=robdiesalot', null, ProbeOk, noop_fun, 0, 0)` → 200.
  2. XHR `GET https://kick.com/api/v2/channels/robdiesalot` přímo v konzoli → 200 a JSON s `chatroom.id`. Totéž přes `FullxmlHttpGet`.
  3. XHR `GET https://kick.com/api/v2/channels/<id kanálu>/messages` → `data.messages`. Ulož do `jsonreferences/kick_history.json`.
  4. `new WebSocket('wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.3.0&flash=false')` se subscribe na `chatrooms.<chatroom>.v2` a `chatroom_<chatroom>`. Pár minut zachytávej `onmessage` a ulož do `jsonreferences/kick_pusher_events.json`.
  5. `FullxmlHttpGet('https://www.youtube.com/@robdiesalot/live', <hlavičky YouTube>, ProbeOk, noop_fun, 0, 0)` → HTML s `"isLiveNow":true` a `videoId`. Pak stránka `live_chat?is_popout=1&v=<id>` a dva až tři POST `get_live_chat` (metoda `'POST'`, tělo JSON, hlavička `Content-Type: application/json`). Výsledky ulož.

  Když `robdiesalot` nevysílá, použij pro YouTube jakýkoli živý kanál, který píše chat, např. `@LofiGirl`, a pro Kick `xqc` nebo jiný živý kanál.

- [ ] **Krok 6: Rozhodnutí go/no-go**
  - Pokud projde všech pět bodů, zapiš do `docs/unitychat-design.md` oddíl 10: „Ověřeno na zařízení <model>, <datum>: vše prošlo.“
  - Pokud YouTube nebo Kick z nativní cesty neprojde, **zastav a nahlas** to uživateli s přesnou odpovědí (status, začátek těla). Další úloha by pak byla změna Java HTTP klienta, která v tomto plánu není.

- [ ] **Krok 7: Vrácení assets a commit vzorků**

```bash
bash release/scripts/up_assets.sh 1
git add jsonreferences/kick_*.json jsonreferences/youtube_*.json docs/unitychat-design.md
git commit -m "Record on-device network probe and sample payloads for YouTube and Kick chat"
```

---

### Úloha 2: Propojení kanálů (`ChatLink.js`)

**Soubory:**
- Vytvořit: `app/specific/ChatLink.js`, `release/scripts/chat-multi-tests.js`
- Upravit: `app/index.html` (script tag)

**Rozhraní:**
- Používá: `Main_getItemJson(key, default)`, `Main_setItem(key, string)`, `FullxmlHttpGet`, `Chat_Id`, `ChatLive_selectedChannel`, `ChatMulti_OnLinks(chat_number, id)` (z úlohy 3, volá se jen za běhu).
- Poskytuje:
  - `ChatLink_StoreKey = 'chat_links'`. V úložišti je objekt `{<login>: {enabled: boolean, yt?: string, kick?: string}}`. Chybějící `yt`/`kick` = z adresáře, `''` = nepropojovat, jinak ruční hodnota.
  - `ChatLink_Get(login) -> {enabled, yt, kick}` (výchozí `{enabled: true}`)
  - `ChatLink_Save(login, entry)`
  - `ChatLink_NormalizeYouTube(input) -> string|null`: vrací `'UC…'` (24 znaků) nebo `'@handle'` malými písmeny.
  - `ChatLink_NormalizeKick(input) -> string|null`: slug malými písmeny.
  - `ChatLink_Resolve(entry, dir) -> {yt: {value, source}|null, kick: {value, source}|null}`, kde `source` je `'manual'` nebo `'dir'`.
  - `ChatLink_DirCache` (`{login: streamer|null}`)
  - `ChatLink_Lookup(chat_number, id)`
  - `ChatLink_LookupResult(obj, chat_number, id)` (pojmenovaný callback)
  - `ChatLink_Current(chat_number) -> výsledek ChatLink_Resolve`

- [ ] **Krok 1: Harness a padající testy.** `release/scripts/chat-multi-tests.js`: `vm` sandbox ve stylu `chat-optimization-tests.js`, včetně `check(value, label)` a výpisu na konci `console.log(checks + ' merged chat checks passed')`. Načte postupně soubory, které existují (`ChatLink.js`, později `ChatMulti.js`, `ChatKick.js`, `ChatYouTube.js`). `Main_getItemJson` a `Main_setItem` jsou stubnuté pamětí. Testy:

```js
check(s.ChatLink_NormalizeYouTube('https://www.youtube.com/@ArcadeBulls/live') === '@arcadebulls', 'yt url handle');
check(s.ChatLink_NormalizeYouTube('arcadebulls') === '@arcadebulls' && s.ChatLink_NormalizeYouTube('@arcadebulls') === '@arcadebulls', 'yt bare handle');
check(s.ChatLink_NormalizeYouTube('youtube.com/channel/UCi41sMqhol1dxVZ7g2UUj7w') === 'UCi41sMqhol1dxVZ7g2UUj7w', 'yt channel url');
check(s.ChatLink_NormalizeYouTube('"><img>') === null && s.ChatLink_NormalizeYouTube('') === null, 'yt rejects junk');
check(s.ChatLink_NormalizeKick('https://kick.com/RobDiesALot') === 'robdiesalot' && s.ChatLink_NormalizeKick('a b') === null, 'kick slug');
var dir = {youtubeHandle: 'arcadebulls', youtubeChannelId: 'UCi41sMqhol1dxVZ7g2UUj7w', kickSlug: null};
var r = s.ChatLink_Resolve({enabled: true}, dir);
check(r.yt.value === 'UCi41sMqhol1dxVZ7g2UUj7w' && r.yt.source === 'dir' && r.kick === null, 'dir prefers channel id, null kick');
check(s.ChatLink_Resolve({enabled: true, yt: ''}, dir).yt === null, 'empty manual disables platform');
check(s.ChatLink_Resolve({enabled: true, kick: 'robdiesalot'}, null).kick.source === 'manual', 'manual works without directory');
check(s.ChatLink_Resolve({enabled: false, kick: 'x'}, dir).kick === null, 'disabled streamer links nothing');
// Review Focus 4: errors are not cached
s.Chat_Id = [7, 0]; s.ChatLive_selectedChannel = ['robdiesalot', ''];
s.ChatLink_LookupResult({status: 0, responseText: ''}, 0, 7);
check(!('robdiesalot' in s.ChatLink_DirCache) && onLinksCalls === 1, 'network error: not cached, links still resolved');
s.ChatLink_LookupResult({status: 404, responseText: '{}'}, 0, 7);
check(s.ChatLink_DirCache.robdiesalot === null, '404 cached as not found');
s.ChatLink_LookupResult({status: 200, responseText: '{"ok":true,"found":true,"streamer":{"kickSlug":"robdiesalot"}}'}, 0, 6);
check(s.ChatLink_DirCache.robdiesalot === null, 'stale generation ignored');
```

(`onLinksCalls` počítá stub `ChatMulti_OnLinks`.)

- [ ] **Krok 2:** `node release/scripts/chat-multi-tests.js` → FAIL (funkce neexistují).
- [ ] **Krok 3:** Implementuj `ChatLink.js` podle rozhraní.
  - Adresář: `https://api.jouki.cz/streamers/lookup?platform=twitch&handle=` + `encodeURIComponent(login)`.
  - Cache se plní jen při 200 (`found ? streamer : null`) a 404.
  - Při cache hit volá `ChatMulti_OnLinks` hned.
  - Neplatný JSON se chová jako chyba sítě.
- [ ] **Krok 4:** `node release/scripts/chat-multi-tests.js` → PASS a `node release/scripts/maker.js jsh` → bez chyb.
- [ ] **Krok 5:** Commit `Add channel link resolution for merged chat (UnityChat directory and manual overrides)`.

---

### Úloha 3: Společné jádro, zapojení do ChatLive a nastavení (`ChatMulti.js`)

**Soubory:**
- Vytvořit: `app/specific/ChatMulti.js`
- Upravit:
  - `app/specific/ChatLive.js`: `ChatLive_Init` :165, `ChatLive_Clear` :2423, `ChatLive_loadChatSuccess` :1839, `ChatLive_CheckIfSubSend` :1818, `ChatLive_ElementAdd` :2289, `ChatLive_ElementAddCheckExtra` :2356,
  - `app/specific/Settings.js`: chat blok :637–711, `Settings_DialogShowChat` :3397,
  - `app/index.html`: CSS u `.tag` :2582, script tag,
  - `app/languages/0_Strings.js`, `app/languages/en_US.js`, `app/languages/untranslated/untranslated_ui_js.txt`.
- Test: `release/scripts/chat-multi-tests.js`

**Rozhraní:**
- Používá: `ChatLink_Lookup`, `ChatLink_Current`, `ChatKick_Start/Stop` a `ChatYouTube_Start/Stop` (úlohy 4 a 5; do té doby se volají jen pokud `typeof … === 'function'`), `ChatLive_LineAddCheckDelay`, `ChatLive_extraMessageTokenize`, `emoteTemplate`, `ChatLive_CleanMessage`, `ChatLive_CleanUser`, `ChatLive_GetTimeStamp`, `Screens_AriaEscape`, `defaultColors`.
- Poskytuje:
  - `ChatMulti_Start(chat_number, id, withHistory)`, `ChatMulti_Stop(chat_number)`, `ChatMulti_Restart(chat_number)` (= Start s aktuálním `Chat_Id` a bez historie), `ChatMulti_OnLinks(chat_number, id)`
  - `ChatMulti_SetLinked(chat_number, linked)`: přidá nebo odebere třídu `chat_linked` na `Chat_div[chat_number]`.
  - `ChatMulti_Icon(platform) -> '<span class="tag chat_pi chat_pi_' + platform + '"></span>'`, kde `platform` je `'tw' | 'yt' | 'kick'`.
  - `ChatMulti_SafeUrl(url, hostRegex) -> string|null`
  - `ChatMulti_NickStyle(platform, nick, color, role) -> 'style="color: …;"'`, kde `role` je `'owner' | 'mod' | 'member' | ''`.
  - `ChatMulti_Line(chat_number, id, msg)`. `msg` = `{platform, msgId, authorId, nick, color, role, badges /*html*/, tokens /*pole stringů a [html]*/, text, ts /*ms*/, history /*bool*/, special /*html hlavičky nebo null*/, highlight /*CSS barva podkladu nebo null*/}`.
  - `ChatMulti_DeleteMsg(platform, msgId)`, `ChatMulti_DeleteAuthor(chat_number, platform, authorId)`
  - `ChatLive_HistoryInsert(box, holder, ts)` (v `ChatLive.js`)
  - `Settings_value.chat_multi` (`{values: ['no', 'yes'], defaultValue: 2}`, tedy zapnuto)

- [ ] **Krok 1: Padající testy** (sandbox načte navíc `ChatLive.js`, `thirdparty/punycode.js`, `thirdparty/twemoji.js`, `thirdparty/kapchat.js` a `ChatMulti.js` se stuby z `chat-optimization-tests.js`; `ChatLive_LineAddCheckDelay` ukládá `messageObj` do pole `lines`):

```js
// Review Focus 1
s.ChatLive_Custom_Nick_Color = 0;
s.ChatMulti_Line(0, 7, {platform: 'kick', msgId: 'a"b', authorId: '1 2', nick: '"><img src=x onerror=1>', color: 'red;x:url(y)',
    role: '', badges: '', tokens: ['<script>x</script>'], text: 't', ts: 1, history: false, special: null, highlight: null});
var html = lines.pop().message;
check(html.indexOf('<img src=x') === -1 && html.indexOf('<script>') === -1 && html.indexOf('url(y)') === -1, 'foreign line is escaped');
check(/id="kick_ab"/.test(html) && /class="kick_12 message"/.test(html), 'ids sanitized and prefixed');
check(s.ChatMulti_SafeUrl('https://evil.example/x.png', /^yt3\.ggpht\.com$/) === null, 'foreign host rejected');
// colors
check(s.ChatMulti_NickStyle('kick', 'bob', '#00ff00', '') === 'style="color: #00ff00;"', 'own color when readable off');
check(s.ChatMulti_NickStyle('yt', 'bob', null, 'mod') === 'style="color: #5e84f1;"', 'youtube role color');
s.ChatLive_Custom_Nick_Color = 1;
check(s.ChatMulti_NickStyle('yt', 'bob', null, 'owner') === 'style="color: ' + s.defaultColors['b'.charCodeAt(0) % s.defaultColorsLength] + ';"', 'readable palette overrides roles');
// dedupe
s.ChatMulti_Line(0, 7, msgWithId('x1')); s.ChatMulti_Line(0, 7, msgWithId('x1'));
check(lines.length === 1, 'same platform message shown once');
// Review Focus 2: stale generation
s.ChatMulti_Line(0, 6, msgWithId('x2')); check(lines.length === 1, 'stale generation dropped');
// Review Focus 3
s.ChatMulti_Start(0, 7, true); var stops = stopCalls; s.ChatLive_Close(0);
check(stopCalls === stops, 'IRC reconnect does not stop foreign sources');
s.ChatLive_Clear(0); check(stopCalls === stops + 1, 'full clear stops foreign sources');
// Review Focus 5: history insert order (fake DOM nodes with firstChild/nextSibling/insertBefore/appendChild)
var box = fakeBox(['live-1']);                       // one live line, no chatTs
s.ChatLive_HistoryInsert(box, node('tw-30'), 30); s.ChatLive_HistoryInsert(box, node('tw-10'), 10);
s.ChatLive_HistoryInsert(box, node('yt-20'), 20);   // late foreign history
check(order(box).join() === 'tw-10,yt-20,tw-30,live-1', 'late history interleaves by time before live lines');
```

(`msgWithId`, `fakeBox`, `node`, `order`, `stopCalls` a `lines` jsou pomocníci v testu. `ChatKick_Stop` a `ChatYouTube_Stop` jsou stuby, které zvyšují `stopCalls`.)

- [ ] **Krok 2:** Spusť testy → FAIL.
- [ ] **Krok 3: `ChatMulti.js`**
  - **`ChatMulti_Start`:**
    - Nejdřív `ChatMulti_Stop` a `SetLinked(false)`.
    - Pokud je `!Settings_value.chat_multi.defaultValue`, konec.
    - Uloží `ChatMulti_State[chat_number] = {id, withHistory}` a zavolá `ChatLink_Lookup`.
    - `ChatMulti_Seen[chat_number]` (objekt pro deduplikaci) vynuluje `Start` i `Stop`.
  - **`ChatMulti_OnLinks`:** `SetLinked(!!(yt || kick))` a spustí zdroje.
  - **`ChatMulti_Line`:**
    1. Kontrola generace.
    2. Deduplikace podle `platform + '_' + msgId` v `ChatMulti_Seen[chat_number]` (vytvoří se líně). Při 500 záznamech se vyprázdní.
    3. Pokud je `ChatLive_HideBots && KnowBots[nick]`, konec.
    4. Sestaví řádek:
       - časové razítko podle `ChatLive_Show_TimeStamp` (`history ? ChatLive_GetTimeStamp(ts) : Main_clock_H_M`),
       - `ChatMulti_Icon`, `badges`,
       - jméno v `<span NickStyle>`, při zvýraznění `chat_Line_highlight_green`,
       - `:&nbsp;`,
       - `<span id="<p>_<msgId>" class="<p>_<authorId> message">` + `ChatLive_extraMessageTokenize(tokens, chat_number, 0)` + `</span>`.
    5. Zvláštní řádek: `<span class="message">` + ikonka + `special` + (zpráva? `STR_BR + STR_BR` + jméno + `: ` + tělo) + `</span>`. Platí jen při `ChatLive_Show_SUB`.
    6. Předá dál `messageObj` `{chat_number, message, nick: nick.toLowerCase(), text, atstreamer, fromstreamer, mod, sub: !!special, addToStart: history, historyTs: history ? ts : 0}`. Zvýraznění se řídí stejnými nastaveními jako u Twitche a ve stejném pořadí:
       - `atstreamer` jen při `ChatLive_Highlight_AtStreamer`,
       - `fromstreamer` (`role === 'owner'`) jen při `ChatLive_Highlight_FromStreamer`,
       - `mod` (`role === 'mod'`) jen při `ChatLive_Highlight_Mod`.
  - **`highlight`** se přidá jako `style="background-color: …"` na `<span class="message">`.
  - **Zmínka streamera** (`atstreamer`) se pozná podle `ChatLive_Channel_Regex_Search[chat_number]`, tedy podle Twitch loginu.
  - **Moderace** volá `ChatLive_CleanMessage({tags: {'target-msg-id': p + '_' + id}})` a `ChatLive_CleanUser(chat_number, {tags: {'target-user-id': p + '_' + authorId}})`.
- [ ] **Krok 4: Zapojení v `ChatLive.js`**
  - Na konci `ChatLive_Init` (za `ChatLive_loadChat`) přidej `ChatMulti_Start(chat_number, Chat_Id[chat_number], !SkipClear);`.
  - Na začátku `ChatLive_Clear` přidej `ChatMulti_Stop(chat_number);`.
  - V `ChatLive_loadChatSuccess` před `ChatLive_GetBadges` přidej `div += ChatMulti_Icon('tw');` a do `messageObj` `historyTs: addToStart && tags['tmi-sent-ts'] ? parseInt(tags['tmi-sent-ts'], 10) : 0`.
  - V `ChatLive_CheckIfSubSend` vlož `ChatMulti_Icon('tw')` na začátek `message`.
  - V `ChatLive_ElementAdd` nahraď `insertBefore(…, childNodes[0])` voláním `ChatLive_HistoryInsert(Chat_div[n], chat_line_holder, messageObj.historyTs)`. `ChatLive_ElementAddCheckExtra` předá `historyTs` dál.
  - `ChatLive_HistoryInsert`:
    - Bez `ts` vloží holder na začátek jako dnes.
    - S `ts` nastaví `holder.chatTs = ts`, projde potomky od `firstChild` a vloží před první uzel bez `chatTs` nebo s `chatTs >= ts`. Když takový není, vloží na konec.
- [ ] **Krok 5: Nastavení a CSS**
  - `Settings_value.chat_multi` přidej za `chat_nickcolor` a položku do `Settings_DialogShowChat` (vzor `chat_nickcolor` :3420 a :3476).
  - Když se v dialogu nastavení vypne, zavolej `ChatMulti_Stop(0)` a `ChatMulti_Stop(1)` přes `Settings_SetDefault`.
  - V `index.html` přidej CSS:
    - `.chat_pi_tw {display: none}`, `.chat_linked .chat_pi_tw {display: inline-block}`,
    - `.chat_pi_tw/.chat_pi_yt/.chat_pi_kick {background-image: url("data:image/svg+xml,…")}` (logo platformy jako v mockupu: fialová, červená a zelená),
    - odznaky rolí `.chat_b_yt_owner`, `.chat_b_yt_mod`, `.chat_b_yt_verified`, `.chat_b_kick_broadcaster|moderator|vip|og|founder|verified|sub_gifter|staff|subscriber` jako vlastní jednoduché SVG data URI. Velikost dědí z `.tag`.
- [ ] **Krok 6: Řetězce** v `0_Strings.js` a `en_US.js`:
  - `STR_CHAT_MULTI = 'YouTube and Kick chat'`,
  - `STR_CHAT_MULTI_SUMMARY = 'Show YouTube and Kick messages of a streamer who multistreams, with their history (channels from the UnityChat directory, editable in Linked chats)'`.

  Do `untranslated_ui_js.txt` přidej řádek „Added in en_US (2026-10-31): STR_CHAT_MULTI, STR_CHAT_MULTI_SUMMARY …“, ke kterému úloha 6 doplní své řetězce.
- [ ] **Krok 7:** Spusť `node release/scripts/chat-multi-tests.js` a `node release/scripts/chat-optimization-tests.js` → PASS (stávající testy se nesmí rozbít). Pak `node release/scripts/maker.js jsh`.
- [ ] **Krok 8:** Ruční kontrola v desktopovém Chrome (`app/index.html`): Twitch chat na kanálu bez propojení vypadá jako dřív, bez ikonek. Na kanálu s ručním propojením (zapsaným do `localStorage` přes `ChatLink_Save`) mají Twitch řádky ikonku.
- [ ] **Krok 9:** Commit `Add merged chat core: platform icons, foreign line rendering, timed history insert, setting`.

---

### Úloha 4: Kick (`ChatKick.js`)

**Soubory:**
- Vytvořit: `app/specific/ChatKick.js`
- Upravit: `app/index.html` (script tag)
- Test: `release/scripts/chat-multi-tests.js` (fixtury z `jsonreferences/kick_*.json`)

**Rozhraní:**
- Používá: `ChatMulti_Line`, `ChatMulti_DeleteMsg`, `ChatMulti_DeleteAuthor`, `ChatMulti_SafeUrl`, `emoteTemplate`, `Screens_AriaEscape`, `FullxmlHttpGet`.
- Poskytuje:
  - `ChatKick_Start(chat_number, id, slug, withHistory)`, `ChatKick_Stop(chat_number)`
  - `ChatKick_PusherFallback = {key: '34bf7a0ff419a2a775b9', cluster: 'us2'}`
  - `ChatKick_EventName(ev) -> string` (bez prefixu `App\Events\`)
  - `ChatKick_Tokens(content) -> pole`: `[emote:<číslo>:<name>]` → `[emoteTemplate('https://files.kick.com/emotes/<id>/fullsize')]`, zbytek jako string.
  - `ChatKick_SubBadgeUrl(subBadges, months) -> string|null`: nejvyšší `months` ≤ `months`.
  - `ChatKick_Badges(identity, subBadges) -> {html, role}`. `role` je `'owner'` pro broadcaster, `'mod'` pro moderator, jinak `''`.
  - `ChatKick_ToMsg(data, subBadges, history) -> msg pro ChatMulti_Line | null`
  - `ChatKick_EventToMsg(name, data) -> msg | {del: msgId} | {ban: userId} | null`

- [ ] **Krok 1: Padající testy:**

```js
var hist = JSON.parse(fs.readFileSync('jsonreferences/kick_history.json', 'utf8'));
var m = s.ChatKick_ToMsg(hist.data.messages[0], [], true);
check(m.platform === 'kick' && m.history === true && m.ts === Date.parse(hist.data.messages[0].created_at), 'history message maps with timestamp');
var t = s.ChatKick_Tokens('hi [emote:37226:KEKW] there [emote:x:bad]');
check(t[1][0].indexOf('https://files.kick.com/emotes/37226/fullsize') !== -1 && t.join('').indexOf('[emote:x:bad]') !== -1, 'numeric emote ids only');
check(s.ChatKick_SubBadgeUrl([{months: 1, badge_image: {src: 'https://files.kick.com/a.png'}}, {months: 6, badge_image: {src: 'https://files.kick.com/b.png'}}], 10) === 'https://files.kick.com/b.png', 'best sub badge');
var b = s.ChatKick_Badges({badges: [{type: 'moderator'}], badges_v2: [{image_url: 'https://evil.example/x.png', selected: true}]}, []);
check(b.role === 'mod' && b.html.indexOf('evil.example') === -1, 'role badge, foreign badge host dropped');
check(s.ChatKick_EventName('App\\Events\\ChatMessageEvent') === 'ChatMessageEvent', 'event prefix stripped');
// Review Focus 2: websocket of the old channel is closed on restart (FakeWebSocket records close())
s.ChatKick_Start(0, 7, 'robdiesalot', false); /* resolve fake XHRs */ var ws1 = sockets[0];
s.ChatKick_Start(0, 8, 'xqc', false); check(ws1.closed, 'restart closes previous socket');
```

Doplň testy pro `SubscriptionEvent`, `GiftedSubscriptionsEvent`, `MessageDeletedEvent` a `UserBannedEvent` podle tvarů zachycených v `kick_pusher_events.json`. Událost, kterou úloha 1 nezachytila, otestuj podle tvaru ze specu 6.2 bod 6 a v kódu ji označ komentářem `// shape not yet seen live`.

- [ ] **Krok 2:** Spusť testy → FAIL.
- [ ] **Krok 3: Implementace**
  - **Info o kanálu** přes `XMLHttpRequest` (Kick posílá CORS) na `https://kick.com/api/v2/channels/<slug>`. Když XHR skončí `status` 0 nebo 403, zkus `FullxmlHttpGet` s callbackem `ChatKick_ChannelNative(obj, chat_number, id)`. Uloží `chatroom.id`, `id` a `subscriber_badges`.
  - **Klíč Pusheru:** XHR `https://api.jouki.cz/kick/realtime`. Při chybě nebo neplatném tvaru (`/^[a-f0-9]{16,40}$/`, `/^[a-z0-9-]{2,12}$/`) se použije `ChatKick_PusherFallback`.
  - **Websocket:**
    - Po `pusher:connection_established` subscribe `chatrooms.<chatroom>.v2` a `chatroom_<chatroom>`.
    - Na `pusher:ping` odpověz `pusher:pong`.
    - `ChatMessageEvent` jen z kanálu `.v2`. Suby a dary z obou kanálů, deduplikace přes `msgId` v `ChatMulti_Line`.
    - Chyba `4001` zahodí uložený klíč.
    - Po `onclose` následuje reconnect za `Math.min(60000, 2000 * Math.pow(2, n))`, se stejnou kontrolou generace.
  - **Historie** (jen `withHistory`): XHR `https://kick.com/api/v2/channels/<id kanálu>/messages` → každá zpráva jde do `ChatMulti_Line` s `history: true`.
  - **Zvláštní řádky:**
    - sub: `special = jméno + ' subscribed for ' + months + ' months'` (řetězec `STR_CHAT_KICK_SUB`),
    - dar: `STR_CHAT_KICK_GIFT` s počtem.
  - **`ChatKick_Stop`** zavře socket (`onclose = null` před `close(1000)`) a zruší timery.
- [ ] **Krok 4:** Spusť testy → PASS, pak `maker.js jsh`.
- [ ] **Krok 5:** Commit `Add Kick chat source: Pusher live messages, history, badges, subs and moderation`.

---

### Úloha 5: YouTube (`ChatYouTube.js`)

**Soubory:**
- Vytvořit: `app/specific/ChatYouTube.js`
- Upravit: `app/index.html` (script tag)
- Test: `release/scripts/chat-multi-tests.js` (fixtury `jsonreferences/youtube_*.json`)

**Rozhraní:**
- Používá: `ChatMulti_Line`, `ChatMulti_DeleteMsg`, `ChatMulti_DeleteAuthor`, `ChatMulti_SafeUrl`, `emoteTemplate`, `FullxmlHttpGet`, `Main_setTimeout`, `Main_clearTimeout`.
- Poskytuje:
  - `ChatYouTube_Start(chat_number, id, target, withHistory)` (`target` je `'UC…'` nebo `'@handle'`), `ChatYouTube_Stop(chat_number)`
  - `ChatYouTube_Headers` (Global Constraints), `ChatYouTube_PollMs = 1000`, `ChatYouTube_RetryMs = 120000`
  - `ChatYouTube_LiveUrl(target) -> 'https://www.youtube.com/channel/UC…/live' | 'https://www.youtube.com/@handle/live'`
  - `ChatYouTube_ParseLive(html) -> videoId|null`: živé jen s `"isLiveNow":true` nebo `"isLive":true`.
  - `ChatYouTube_ParseChatPage(html) -> {key, context, continuation, actions}|null`
  - `ChatYouTube_ParsePoll(text) -> {actions, continuation}|null`
  - `ChatYouTube_Tokens(runs) -> pole`: `emoji` s bezpečnou URL → `[emoteTemplate(url)]`, jinak `shortcuts[0]` jako text.
  - `ChatYouTube_Badges(authorBadges) -> {html, role}`, kde `role` je `owner`, `mod`, `member` nebo `''`.
  - `ChatYouTube_ToMsg(item, history) -> msg|null`
  - `ChatYouTube_Moderation(action) -> {del: id}|{ban: channelId}|null`
  - Pojmenované callbacky `ChatYouTube_LiveResult`, `ChatYouTube_PageResult` a `ChatYouTube_PollResult`, všechny `(obj, chat_number, id)`.

- [ ] **Krok 1: Padající testy:**

```js
check(s.ChatYouTube_ParseLive('..."isLiveNow":true..."videoId":"-a9764YAN_8"...') === '-a9764YAN_8', 'live detected');
check(s.ChatYouTube_ParseLive('..."videoId":"-a9764YAN_8"...') === null, 'not live without marker');
var acts = JSON.parse(fs.readFileSync('jsonreferences/youtube_chat_initial_actions.json', 'utf8'));
var msgs = acts.map(function (a) { return a.addChatItemAction && s.ChatYouTube_ToMsg(a.addChatItemAction.item, true); }).filter(Boolean);
check(msgs.length > 0 && msgs.every(function (m) { return m.history && m.ts > 1.7e12; }), 'initial actions become history with ms timestamps');
check(s.ChatYouTube_ToMsg({liveChatViewerEngagementMessageRenderer: {id: 'x'}}, false) === null, 'system banner ignored');
var paid = s.ChatYouTube_ToMsg({liveChatPaidMessageRenderer: {id: 'p', timestampUsec: '1793476496725195', authorName: {simpleText: 'A'},
    authorExternalChannelId: 'UCx', purchaseAmountText: {simpleText: '100,00 Kč'}, bodyBackgroundColor: 4280150454, message: {runs: [{text: 'hi'}]}}}, false);
check(paid.special.indexOf('100,00 Kč') !== -1 && /^rgba?\(/.test(paid.highlight), 'super chat amount and color');
var tok = s.ChatYouTube_Tokens([{text: 'a'}, {emoji: {image: {thumbnails: [{url: 'https://evil.example/e.png'}]}, shortcuts: [':x:']}}]);
check(tok.join('').indexOf('evil.example') === -1 && tok.join('').indexOf(':x:') !== -1, 'emoji from foreign host falls back to shortcut');
check(s.ChatYouTube_Moderation({markChatItemAsDeletedAction: {targetItemId: 'm1'}}).del === 'm1', 'delete action');
// Review Focus 2: a poll result of an old generation does not schedule another poll
s.Chat_Id[0] = 9; s.ChatYouTube_PollResult({status: 200, responseText: '{}'}, 0, 8);
check(pendingTimers() === 0, 'stale poll stops');
```

Doplň testy pro `liveChatMembershipItemRenderer`, `liveChatPaidStickerRenderer` a obě oznámení o darovaných členstvích podle `youtube_get_live_chat.json`, pokud je úloha 1 zachytila. Jinak podle tvaru ve specu 6.3 bod 4, s komentářem `// shape not yet seen live`.

- [ ] **Krok 2:** Spusť testy → FAIL.
- [ ] **Krok 3: Implementace**
  - **Tok:** `LiveUrl` → `FullxmlHttpGet(GET)` → `ParseLive`.
    - Když stream nevysílá nebo `status` ≠ 200, nastaví se timer na `ChatYouTube_RetryMs` a v chatu nic.
  - **Stránka chatu:** `https://www.youtube.com/live_chat?is_popout=1&v=<id>` → `ParseChatPage`.
    - `ytInitialData` = JSON za `ytInitialData"] = ` nebo `var ytInitialData = ` až po `;</script>`.
    - Akce v `contents.liveChatRenderer.actions`, token v `contents.liveChatRenderer.continuations[0]` (`invalidationContinuationData` nebo `timedContinuationData`).
    - `INNERTUBE_API_KEY` a `INNERTUBE_CONTEXT` regexem z `ytcfg`.
  - **Historie** (jen `withHistory`): akce ze stránky jdou do `ChatMulti_Line` s `history: true`.
  - **Polling** každých `ChatYouTube_PollMs` po dokončení předchozího dotazu:
    - `POST https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=<key>&prettyPrint=false`, tělo `JSON.stringify({context, continuation})`, hlavičky YouTube a `['Content-Type', 'application/json']`.
    - Bez tokenu nebo při chybě se znovu načte stránka chatu.
    - `addChatItemAction` se seřadí podle `timestampUsec`. První se zobrazí hned, další přes `Main_setTimeout` za `Math.min(ts - ts0, ChatYouTube_PollMs)` ms (s kontrolou generace).
    - Akce moderace jdou na `ChatMulti_DeleteMsg` a `ChatMulti_DeleteAuthor`.
  - **Barvy podkladu:** `bodyBackgroundColor` je ARGB int, převod na `rgba(r,g,b,a)`.
  - **Povolené hosty obrázků:** `/^(yt3\.ggpht\.com|yt4\.ggpht\.com|[a-z0-9-]+\.googleusercontent\.com|www\.youtube\.com|www\.gstatic\.com)$/`.
  - **Zvláštní řádky:** použij texty YouTube (`headerSubtext`, `primaryText` jako prostý text runs, escapovaný). Pro Super Chat `STR_CHAT_YT_SUPERCHAT + ' ' + částka`.
  - **`ChatYouTube_Stop`** zruší všechny timery slotu. Odpovědi, které dorazí po zastavení, zahodí kontrola generace.
- [ ] **Krok 4:** Spusť testy → PASS, pak `maker.js jsh`.
- [ ] **Krok 5:** Commit `Add YouTube chat source: innertube polling, history, badges, Super Chats, memberships and moderation`.

---

### Úloha 6: Dialog „Propojené chaty“ v přehrávači (`ChatLinkDialog.js`)

**Soubory:**
- Vytvořit: `app/specific/ChatLinkDialog.js`
- Upravit:
  - `app/specific/PlayEtc.js`: `var Play_controlsLinkedChats` za `Play_controlsPhoneChat` (:2028) a definice vedle `Play_controlsPhoneChat` (:2998),
  - `app/specific/PlayerUI.js:10`: skupina `chat`, za `Play_controlsChatSettings`,
  - `app/index.html`: markup dialogu vedle `dialog_phone_chat` (:5150) a script tag,
  - řetězce v `0_Strings.js`, `en_US.js` a `untranslated_ui_js.txt`.
- Test: `release/scripts/chat-multi-tests.js`

**Rozhraní:**
- Používá: `ChatLink_Get`, `ChatLink_Save`, `ChatLink_Current`, `ChatLink_NormalizeYouTube`, `ChatLink_NormalizeKick`, `ChatMulti_Restart`, vzor otevření a zavření a předání kláves z `PhoneChat_Show`, `PhoneChat_Hide` a `PhoneChat_HandleKeyDown` (`PhoneChat.js:143–260`), vzor fokusu klávesnice z `ChatLiveControls_inputFocus` (`ChatLiveControls.js:146`).
- Poskytuje:
  - `ChatLinkDialog_Show()`, `ChatLinkDialog_Hide(skipFocusRestore)`, `ChatLinkDialog_HandleKeyDown(e)`
  - `ChatLinkDialog_Rows(entry, resolved) -> [{kind: 'yt'|'kick'|'enabled'|'reset'|'close', label, value, source}]` (čistá funkce)
  - `ChatLinkDialog_Apply(login, kind, rawInput) -> boolean` (uloží normalizovanou hodnotu, prázdný vstup uloží `''`, neplatný vrátí `false`)

- [ ] **Krok 1: Padající testy:**

```js
var rows = s.ChatLinkDialog_Rows({enabled: true, kick: 'robdiesalot'}, {yt: {value: '@arcadebulls', source: 'dir'}, kick: {value: 'robdiesalot', source: 'manual'}});
check(rows.map(function (r) { return r.kind; }).join() === 'yt,kick,enabled,reset,close', 'rows with reset when a manual value exists');
check(s.ChatLinkDialog_Rows({enabled: true}, {yt: null, kick: null}).map(function (r) { return r.kind; }).join() === 'yt,kick,enabled,close', 'no reset without manual values');
check(s.ChatLinkDialog_Apply('arcadebulls', 'yt', 'https://youtube.com/@ArcadeBulls') && s.ChatLink_Get('arcadebulls').yt === '@arcadebulls', 'apply normalizes');
check(s.ChatLinkDialog_Apply('arcadebulls', 'kick', '') && s.ChatLink_Get('arcadebulls').kick === '', 'empty input means do not link');
check(!s.ChatLinkDialog_Apply('arcadebulls', 'kick', 'a b c'), 'invalid input rejected and not saved');
```

- [ ] **Krok 2:** Spusť testy → FAIL.
- [ ] **Krok 3: Implementace**
  - **Dialog** platí pro chat 0 (`ChatLive_selectedChannel[0]`, zobrazované jméno `Play_data.data[1]`).
  - **Řádky** podle mockupu, varianty A ve specu 6.7:
    - zdroj hodnoty: `STR_CHAT_LINK_FROM_DIR` „from UnityChat“, `STR_CHAT_LINK_MANUAL` „manual“, `STR_CHAT_LINK_NONE` „not found“,
    - akce: `STR_CHAT_LINK_EDIT` „Edit“ nebo „Enter“, `STR_CHAT_LINK_ENABLED`, `STR_CHAT_LINK_RESET` „Back to UnityChat“, `STR_CLOSE`.
  - **Ovládání:** ↑ a ↓ přesouvají fokus (třída `button_dialog_focused`), OK aktivuje, Zpět zavře.
  - **Úprava** ukáže `<input id="chat_link_input">` s předvyplněnou hodnotou a fokusem podle `ChatLiveControls_inputFocus`, včetně `OptionsShowObj.keyboard_options`.
    - `KEY_KEYBOARD_DONE` nebo `KEY_ENTER` → `ChatLinkDialog_Apply`. Při `false` se ukáže `Play_showWarningMiddleDialog(STR_CHAT_LINK_INVALID, 2000)` a vstup zůstane otevřený.
    - `KEY_RETURN` vstup zruší.
  - **Po každé uložené změně** zavolej `ChatMulti_Restart(0)`. Pokud je PiP a chat 1 má stejný login, i `ChatMulti_Restart(1)`.
  - **Ovládací prvek:** `Play_controls[Play_controlsLinkedChats]`
    - `ShowInLive: true`, `ShowInPP: true`, `ShowInMulti: true`, ostatní `false`,
    - `string: STR_CHAT_LINKED` „Linked chats“,
    - `icons`: některá existující ikona z fontu (stejně jako `'globe'` u telefonního chatu),
    - `enterKey: function () { ChatLinkDialog_Show(); }`.
  - **Vzhled** podle `DESIGN.md` (fokus `#bca0ff` outline, tmavý povrch) a stylu `dialog_phone_chat`.
- [ ] **Krok 4:** Spusť testy → PASS, pak `maker.js jsh`.
- [ ] **Krok 5:** Ruční kontrola v Chrome (`app/index.html`, šipky, Enter, Esc): dialog se otevře z ovládání, vstup se uloží a zavře a fokus se vrátí na tlačítko.
- [ ] **Krok 6:** Commit `Add Linked chats player dialog for manual YouTube and Kick channel overrides`.

---

### Úloha 7: Akceptace na TV a vydání APK a webu

**Soubory:**
- Upravit:
  - `app/general/version.js`: `publishVersionCode` 394 → **395**, `ApkUrl` → `…/releases/download/395/SmarterPurpleTV_3_0_395.apk`, `WebTag` 771 → **772**, `WebVersion` → datum vydání, záznam do `changelog`,
  - `apk/versions.gradle`: `publishVersionCode: 395`,
  - `apk/Changelog.md`: stejný záznam,
  - `release/**` (generuje se).

- [ ] **Krok 1:** Spusť všechny harnessy z `AGENTS.md` a `node release/scripts/chat-multi-tests.js` → PASS. Pak `node release/scripts/maker.js` (plná sestava) → bez chyb.
- [ ] **Krok 2:** `bash release/scripts/up_assets.sh` a `cd apk && ./gradlew assembleDebug` a instalace na TV (`adb install -r`).
- [ ] **Krok 3: Akceptace na TV.** Každý bod se zaznamená jako prošlo nebo neprošlo do `docs/unitychat-design.md` oddíl 10.
  - **`robdiesalot` živě** (Twitch, YouTube a Kick):
    - zprávy ze všech tří platforem,
    - ikonky u všech řádků, odznaky a barvy při „Readable nick colors“ zapnuto i vypnuto,
    - historie proložená podle času,
    - YouTube zpoždění kolem 3 s.
  - **PiP a 50/50** se dvěma propojenými kanály: v chatu 1 totéž. Po prohození (`ChatLive_Switch`) se zprávy nezdvojí.
  - **Multistream:** chat 0 se přepojí s vybraným streamem.
  - **Dialog:** přepis Kick slugu, prázdná hodnota, vypnutí streamera, „Back to UnityChat“.
  - **Nastavení** „YouTube and Kick chat“ vypnuto: žádné ikonky a žádné cizí zprávy.
  - **`arcadebulls`** (jen YouTube), pokud vysílá: YouTube zprávy ano, Kick žádný, dialog ukazuje Kick „not found“.
  - **Kanál bez propojení** vypadá jako před změnou.
  - **Odpojení sítě na 30 s:** Twitch chat se obnoví jako dřív a Kick se znovu připojí.
- [ ] **Krok 4: Vydání podle `AGENTS.md`**
  - Navýšení verzí a changelog (anglicky, ve stylu předchozích záznamů, bez em dash U+2014).
  - `bash release/scripts/up_assets.sh 1`, `node release/scripts/maker.js`.
  - Release APK (`./gradlew assembleRelease`, podepisování podle dosavadního postupu autora; pokud není znám, zeptej se uživatele).
- [ ] **Krok 5:** Commit `Release 3.0.395: merged YouTube and Kick chat (UnityChat directory, linked chats dialog, badges, Super Chats, history); Web 772` a regenerovaný `release/`.
- [ ] **Krok 6:** **Zeptej se uživatele** před `git push` (nasadí web přes GitHub Pages) a před nahráním APK do GitHub Release. APK pro TV předej jako cestu k souboru.
