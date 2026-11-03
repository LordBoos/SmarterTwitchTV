# Lišta nad sloučeným chatem – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** U chatu s propojenými platformami ukázat nad chatem dvouřádkovou lištu: celkový počet diváků a pro každou platformu ikonku, počet diváků a barevnou tečku stavu připojení.

**Architecture:**
- Nový soubor `app/specific/ChatStatus.js` drží stav lišty pro každý chat a kreslí ji. Má čisté funkce pro text, barvu tečky a součet a časovač obnovy počtů jednou za minutu.
- `ChatMulti_OnLinks` lištu spustí, `ChatMulti_Stop` ji zastaví.
- Zdroje hlásí stav a počty přes `ChatStatus_Set` a `ChatStatus_SetViewers`: Twitch IRC v `ChatLive.js`, `ChatYouTube.js` a `ChatKick.js`.
- Každý zdroj si počet diváků stahuje sám, `ChatStatus_Refresh` je jen volá.

**Tech Stack:** vanilla ES5 JS (staré TV WebView), testy v Node `vm` sandboxu (`release/scripts/chat-multi-tests.js`).

**Spec:** `docs/chat-header-design.md`

## Global Constraints

- ES5 bez modulů a bez arrow funkcí v `app/`, JSHint (`===`, žádné nepoužité ani nedefinované proměnné), Prettier: 4 mezery, šířka 150, jednoduché uvozovky.
- Callbacky `FullxmlHttpGet` a `BaseXmlHttpGet` jsou pojmenované funkce na nejvyšší úrovni (volají se podle jména). Síťová chyba = `status: 0` v úspěšném callbacku `FullxmlHttpGet`.
- Každý asynchronní výsledek kontroluje relaci: `seq` z `ChatMulti_State[chat_number].seq` a zdroj přes svou `*_Live`/`*_Current`.
- Počet diváků se přijímá jen jako konečné celé číslo `>= 0`. Nic z odpovědi se nevkládá jako HTML.
- Texty: `STR_CHAT_STATUS_NOT_FOUND = 'not found'`, `STR_CHAT_STATUS_ERROR = 'error'`, `STR_CHAT_STATUS_OFFLINE = 'offline'` v `app/languages/en_US.js` a stejné klíče v `app/languages/untranslated/untranslated_ui_js.txt`.
- Barvy teček: připojeno `#2ecc40`, připojuje se `#f5c400`, chyba `#ff3b3b`, offline bez chatu `#888888`.
- Obnova počtů `ChatStatus_RefreshMs = 60000`.
- Výšky: řádek součtu `font-size 2.5vh`, `height 2.8vh`. Řádek platforem `font-size 2vh`, `height 2.4vh`. `chat_box_holder` je při aktivní liště `calc(100% - 5.3vh)`, u chatu 0 má `chat_container_name` `top: 5.4vh`.
- Nikdy needitovat `release/` ručně. Vydání je jen webové, **Web 776**, bez změny APK.
- Práce na větvi `feature/chat-status` v místě (worktree nejde kvůli cestě k `media`). Commit message bez Claude patičky.

## Review Focus

1. **Špatný ruční YouTube handle (404 na `/live`)** – červené `not found` hned po první odpovědi, ne věčné „připojuje se“. Test v úloze 3.
2. **Kick kanál blokovaný Cloudflare na TV** (XHR 403 a pak neúspěšná nativní záloha) – červené `error`, nikdy zelená. Test v úloze 4.
3. **Obnova počtu selže po předchozím úspěchu** – tečka i poslední počet zůstanou. Testy v úlohách 2, 3 a 4.
4. **Pozdní odpověď po zavření nebo restartu chatu** (PiP prohození, změna propojení) – nesmí přepsat lištu nové relace. Testy v úlohách 1 a 3.
5. **YouTube stream skončí během sledování** (řetězec pollingu se přeruší, nové hledání `/live` nenajde živé video) – šedé `offline` a YouTube vypadne ze součtu. Test v úloze 3.

---

### Task 1: Jádro lišty (`ChatStatus.js`), markup, CSS, napojení na ChatMulti

**Files:**
- Create: `app/specific/ChatStatus.js`
- Modify: `app/specific/ChatMulti.js` (`ChatMulti_OnLinks`, `ChatMulti_Stop`)
- Modify: `app/index.html` (`<div id="chat_status0|1" class="chat_status hide"></div>` hned za `chat_loggedin0|1`, CSS vedle `.chat_loggedin`, `<script src="specific/ChatStatus.js" defer></script>` vedle `ChatMulti.js`)
- Modify: `app/languages/en_US.js`, `app/languages/untranslated/untranslated_ui_js.txt`
- Test: `release/scripts/chat-multi-tests.js` (přidat `'ChatStatus.js'` do `FILES`, nová sekce)

**Interfaces:**
- Produces:
  - `ChatStatus_State[chat_number]` = `{seq, order, twLogin, p, timer}`. `order` je pole kódů `'tw' | 'kick' | 'yt'` (platforma streamu první). `p[code]` = `{state, viewers, live}`. `state` je `'connecting' | 'ok' | 'offline' | 'notfound' | 'error'`, `viewers` je `number | null`, `live` je `boolean | null`.
  - `ChatStatus_Start(chat_number, seq, order, twLogin)`: počáteční `tw.state` = `ChatLive_loaded[chat_number] ? 'ok' : 'connecting'`, ostatní `'connecting'`. Zobrazí lištu, vykreslí ji, spustí `Main_setInterval(ChatStatus_Refresh, 60000)` a hned jednou zavolá `ChatStatus_Refresh`. YouTube a Kick v tu chvíli ještě nic nestahují, svůj první počet pošlou samy po načtení (úlohy 3 a 4).
  - `ChatStatus_Stop(chat_number)`: zastaví časovač, stav nastaví na `null` a obnoví jednořádkovou lištu podle nastavení.
  - `ChatStatus_Set(chat_number, platform, state, seq)`: `seq` je nepovinné. Ignoruje se bez aktivního stavu, při platformě mimo `order` nebo při `seq !== st.seq`, když je `seq` zadané. Překreslí lištu.
  - `ChatStatus_SetViewers(chat_number, platform, viewers, live, seq)`: stejné stráže. `viewers` se uloží jen jako konečné celé číslo `>= 0`, jinak zůstane předchozí hodnota. `live` se uloží vždy, když je boolean. Překreslí lištu.
  - `ChatStatus_Label(entry) -> string`, `ChatStatus_Dot(entry) -> 'ok' | 'wait' | 'bad' | 'off'`, `ChatStatus_Total(st) -> number | null`.
  - `ChatStatus_Refresh(chat_number)` volá podle `order`: `ChatStatus_TwitchViewers(chat_number, seq)` (úloha 2), `ChatYouTube_Viewers(chat_number)` (úloha 3) a `ChatKick_Viewers(chat_number)` (úloha 4). Každé volání chrání `typeof … === 'function'`.

- [ ] **Krok 1: Napsat padající testy** (sekce `// Chat status bar (ChatStatus.js)` na `coreSandbox()`, stuby `Main_formatNumber = n => n.toLocaleString('en-US')`, `Main_GetViewerStrings = () => 'viewers'`, DOM stuby pro `Main_getElementById`, `Main_AddClass`, `Main_RemoveClass`, `Main_innerHTML`, časovače jako ve stávajících sekcích):

```js
const E = (state, viewers, live) => ({state, viewers: viewers === undefined ? null : viewers, live: live === undefined ? null : live});
check(s.ChatStatus_Label(E('notfound')) === 'not found' && s.ChatStatus_Dot(E('notfound')) === 'bad', 'not found is red with reason');
check(s.ChatStatus_Label(E('error')) === 'error' && s.ChatStatus_Dot(E('error')) === 'bad', 'error is red');
check(s.ChatStatus_Label(E('offline')) === 'offline' && s.ChatStatus_Dot(E('offline')) === 'off', 'youtube offline is grey');
check(s.ChatStatus_Label(E('ok', 1753, true)) === '1,753' && s.ChatStatus_Dot(E('ok', 1753, true)) === 'ok', 'connected shows the count');
check(s.ChatStatus_Label(E('ok', 99, false)) === 'offline' && s.ChatStatus_Dot(E('ok', 99, false)) === 'ok', 'connected chat of a channel that is not live: green offline');
check(s.ChatStatus_Label(E('connecting')) === '...' && s.ChatStatus_Dot(E('connecting')) === 'wait', 'connecting is yellow, count unknown');
check(s.ChatStatus_Total({order: ['tw', 'kick', 'yt'], p: {tw: E('ok', 553, true), kick: E('ok', 1200, true), yt: E('notfound')}}) === 1753, 'total sums known live counts');
check(s.ChatStatus_Total({order: ['tw', 'kick'], p: {tw: E('ok', 553, true), kick: E('ok', 40, false)}}) === 553, 'offline platform is not counted');
check(s.ChatStatus_Total({order: ['tw'], p: {tw: E('connecting')}}) === null, 'no known count: null');
// lifecycle through ChatMulti_OnLinks with ChatLink_Current stubbed
// twitch chat with kick + yt links -> order 'tw,kick,yt', twLogin = stream login
// kick chat (ChatLive_selectedChannel_id 'kick:x') with tw + yt links -> order 'kick,tw,yt', twLogin = links.tw.value
// no links -> ChatStatus_State[0] is falsy and chat_status0 stays hidden
// show_chatters 0 and links -> chat_status0 shown (no 'hide' class)
// ChatStatus_Set(0, 'yt', 'ok', seq - 1) leaves 'connecting'; ChatStatus_SetViewers(0, 'tw', 'abc', true, seq) and 12.5 leave viewers null
// ChatMulti_Stop(0): the refresh interval is cleared, ChatStatus_State[0] === null, chat_status0 hidden
```

- [ ] **Krok 2:** Spustit `node release/scripts/chat-multi-tests.js`. Očekávané: pád na prvním novém `check` (`ChatStatus_Label is not a function`).
- [ ] **Krok 3: Implementovat `ChatStatus.js` podle rozhraní výše.**
  - Text: `notfound` → `STR_CHAT_STATUS_NOT_FOUND`, `error` → `STR_CHAT_STATUS_ERROR`, `offline` → `STR_CHAT_STATUS_OFFLINE`. Jinak `live === false` → offline, `viewers !== null` → `Main_formatNumber(viewers)`, jinak `'...'`.
  - Tečka: `ok` → `'ok'`, `connecting` → `'wait'`, `offline` → `'off'`, ostatní → `'bad'`.
  - Součet zahrnuje jen `viewers !== null`, `live !== false` a stav `ok` nebo `connecting`.
  - Řádek 1: `'...'` nebo `Main_formatNumber(total) + STR_SPACE_HTML + Main_GetViewerStrings(total)`. Řádek 2: pro každou platformu `ChatMulti_Icon(code)`, text a `<span class="chat_status_dot chat_status_<dot>"></span>`, oddělené `|`.
  - Zobrazení: skrýt `chat_loggedin<n>`, ukázat `chat_status<n>`, nastavit výšky z Global Constraints.
  - Stop: skrýt `chat_status<n>`. Když `Settings_value.show_chatters.defaultValue && !KickApi_IsKickId(ChatLive_selectedChannel_id[n])`, obnovit jednořádkovou lištu (`chat_loggedin<n>` viditelný, `calc(100% - 2.9vh)`, `top: 3vh` u chatu 0). Jinak výšky `''`.
  - CSS `.chat_status` převezme `text-shadow` a zarovnání z `.chat_loggedin`, `.tag` uvnitř má velikost řádku a text u `bad` má barvu `#ff6b6b`.
- [ ] **Krok 4: Napojit `ChatMulti.js`.**
  - `ChatMulti_Stop` jako první příkaz zavolá `if (typeof ChatStatus_Stop === 'function') ChatStatus_Stop(chat_number);`. Musí být před `ChatLive_StopLinkedTwitch`, jinak by zavření IRC přepsalo stav.
  - `ChatMulti_OnLinks` nejdřív spočítá `links`, pak `ChatStatus_Start`, když je aspoň jeden link, a teprve pak spouští zdroje. Spuštění hlavního Kick chatu se přesune za `ChatStatus_Start`.
- [ ] **Krok 5:** Spustit `node release/scripts/chat-multi-tests.js` a `node release/scripts/maker.js jsh`. Očekávané: `… merged chat checks passed`, JSHint bez chyb.
- [ ] **Krok 6:** Commit `Chat status bar: state, rendering and ChatMulti wiring`.

### Task 2: Twitch – počet diváků, existence propojeného kanálu, stav IRC

**Files:**
- Modify: `app/specific/ChatStatus.js` (Twitch funkce)
- Modify: `app/specific/ChatLive.js`:
  - větev `case 'JOIN'` uvnitř `if (!ChatLive_loaded[chat_number])`,
  - `ChatLive_Close`,
  - `ChatLive_LinkedRetry` (větev `tries > ChatLive_LinkedMaxTries`),
  - `ChatLive_UserNoticeCheck` (větev `ChatLive_LinkedFailRegex`)
- Test: `release/scripts/chat-multi-tests.js`, stub `s.ChatStatus_Set = noop` v `release/scripts/chat-optimization-tests.js` vedle `ChatMulti_Start/Stop`

**Interfaces:**
- Consumes: `ChatStatus_Set`, `ChatStatus_SetViewers`, `ChatStatus_State[n].twLogin` (úloha 1).
- Produces:
  - `ChatStatus_TwitchViewers(chat_number, seq)` → `BaseXmlHttpGet(Main_helix_api + 'streams?user_login=' + encodeURIComponent(twLogin), ChatStatus_TwitchViewersResult, noop_fun, chat_number, seq, true)`.
  - `ChatStatus_TwitchViewersResult(responseText, chat_number, seq)`: `data[0].viewer_count` → `SetViewers(…, 'tw', count, true, seq)`. Prázdné `data` → `SetViewers(…, 'tw', null, false, seq)`. Nečitelný JSON → nic.
  - `ChatStatus_TwitchExists(chat_number, seq)`, volá se z `ChatStatus_Start` jen když `order[0] === 'kick'` a `'tw'` je v `order`: `users?login=` → `ChatStatus_TwitchExistsResult`. Prázdné `data` → `Set(…, 'tw', 'notfound', seq)`.

- [ ] **Krok 1: Napsat padající testy:**

```js
// ChatStatus_TwitchViewersResult('{"data":[{"viewer_count":553}]}', 0, seq) -> p.tw.viewers === 553, live true
// '{"data":[]}' -> live false, label 'offline', dot unchanged
// after 553: '<html>' -> viewers still 553, state still 'ok'   (Review Focus 3)
// kick chat order 'kick,tw,yt': ChatStatus_TwitchExistsResult('{"data":[]}', 0, seq) -> p.tw.state === 'notfound'
// result with seq - 1 -> ignored
```

- [ ] **Krok 2:** Spustit `node release/scripts/chat-multi-tests.js`, očekávaný pád.
- [ ] **Krok 3:** Implementovat Twitch funkce. Hooky v `ChatLive.js`:
  - `JOIN` (první připojení) → `ChatStatus_Set(chat_number, 'tw', 'ok')`.
  - `ChatLive_Close` → `ChatStatus_Set(chat_number, 'tw', 'connecting')`.
  - `ChatLive_LinkedRetry` po vyčerpání pokusů a `ChatLive_UserNoticeCheck` u `ChatLive_LinkedFailRegex` → `ChatStatus_Set(chat_number, 'tw', 'error')` **až po** `ChatLive_StopLinkedTwitch`, protože ten volá `Close`.
  - Hooky volat jen přes `typeof ChatStatus_Set === 'function'`, nebo přidat stuby do harnessů, které načítají `ChatLive.js` bez `ChatStatus.js`.
- [ ] **Krok 4:** Spustit `node release/scripts/chat-multi-tests.js`, `node release/scripts/chat-optimization-tests.js` a `node release/scripts/maker.js jsh`. Vše projde.
- [ ] **Krok 5:** Commit `Chat status bar: Twitch viewers and IRC state`.

### Task 3: YouTube – stav a počet diváků

**Files:**
- Modify: `app/specific/ChatYouTube.js`
- Test: `release/scripts/chat-multi-tests.js` (sekce YouTube)

**Interfaces:**
- Consumes: `ChatStatus_Set`, `ChatStatus_SetViewers` (úloha 1).
- Produces:
  - `ChatYouTube_ViewersUrl = 'https://www.youtube.com/youtubei/v1/updated_metadata?prettyPrint=false&key='`.
  - `ChatYouTube_Viewers(chat_number)`: jen když `st.loaded && st.key && st.videoId`. `FullxmlHttpGet(url + encodeURIComponent(st.key), ChatYouTube_Headers.concat([['Content-Type', 'application/json']]), ChatYouTube_ViewersResult, noop_fun, chat_number, st.seq, 'POST', JSON.stringify({context: st.context, videoId: st.videoId}))`.
  - `ChatYouTube_ParseViewers(text) -> number | null`: projde `actions[]` a najde `updateViewershipAction.viewCount.videoViewCountRenderer.originalViewCount`. Bere jen číslice. `simpleText` je lokalizovaný a nepoužívá se.
  - `ChatYouTube_ViewersResult(obj, chat_number, seq)`: `ChatYouTube_Current` a `status 200` → `SetViewers(…, 'yt', n, true, seq)`, jinak nic.

- [ ] **Krok 1: Napsat padající testy:**

```js
const META = '{"actions":[{"updateViewershipAction":{"viewCount":{"videoViewCountRenderer":{"viewCount":{"simpleText":"Právě sleduje: 513"},"isLive":true,"originalViewCount":"513"}}}}]}';
check(s.ChatYouTube_ParseViewers(META) === 513, 'viewers from originalViewCount');
check(s.ChatYouTube_ParseViewers('{"actions":[]}') === null && s.ChatYouTube_ParseViewers('<html>') === null, 'no count: null');
// LiveResult {status: 404} -> p.yt.state === 'notfound'               (Review Focus 1, wrong manual handle)
// LiveResult {status: 200, responseText: 'no live marker'} -> 'offline'
// LiveResult {status: 0} -> 'error'
// PageResult unparsable page -> 'error'; good page -> still 'connecting' and a ChatYouTube_ViewersResult request in http[]
// PollResult good -> 'ok'; then broken poll -> 'connecting'; then LiveResult without live video -> 'offline', total drops yt   (Review Focus 5)
// ViewersResult 513 then ViewersResult {status: 0} -> viewers still 513     (Review Focus 3)
// ViewersResult with an old seq after ChatMulti_Restart -> new session viewers stay null     (Review Focus 4)
```

- [ ] **Krok 2:** Spustit testy, očekávaný pád.
- [ ] **Krok 3: Implementovat.**
  - `ChatYouTube_Start` s neplatným cílem → `'error'`.
  - `ChatYouTube_LiveResult`: `404` → `'notfound'`, `200` bez videa → `'offline'`, jinak bez videa → `'error'`. Retry zůstává jako dnes.
  - `ChatYouTube_PageResult`: neplatná stránka → `'error'`, úspěch → zavolat `ChatYouTube_Viewers` (první počet).
  - `ChatYouTube_PollResult`: úspěch → `'ok'`, přerušený řetězec → `'connecting'`.
- [ ] **Krok 4:** Spustit `node release/scripts/chat-multi-tests.js` a `node release/scripts/maker.js jsh`. Projde.
- [ ] **Krok 5:** Commit `Chat status bar: YouTube state and viewers`.

### Task 4: Kick – stav a počet diváků

**Files:**
- Modify: `app/specific/ChatKick.js`
- Test: `release/scripts/chat-multi-tests.js` (sekce Kick)

**Interfaces:**
- Consumes: `ChatStatus_Set`, `ChatStatus_SetViewers` (úloha 1).
- Produces:
  - `ChatKick_ViewersOf(json) -> {viewers: number | null, live: boolean}`: `live` = `!!json.livestream`, `viewers` = `Number(json.livestream.viewer_count)` při živém vysílání, jinak `null`. Validace je v `SetViewers`.
  - `ChatKick_Viewers(chat_number)`: jen když `ChatKick_Live` a `st.chatroom`. `ChatKick_Xhr(ChatKick_ChannelUrl + slug)` → `200` → `SetViewers`, `0`/`403` → `FullxmlHttpGet(…, ChatKick_ViewersNative, …)`, ostatní → nic.
  - `ChatKick_ViewersNative(obj, chat_number, seq)`.

- [ ] **Krok 1: Napsat padající testy:**

```js
// XHR 404 on the channel -> p.kick.state === 'notfound'
// XHR 403, then ChatKick_ChannelNative({status: 0}) -> 'error'          (Review Focus 2, Cloudflare on TV)
// channel 200 '{"id":5,"chatroom":{"id":9},"livestream":{"viewer_count":1200}}' -> viewers 1200, live true, state 'connecting'
// pusher_internal:subscription_succeeded -> 'ok'; socket onclose -> 'connecting'
// channel 200 with "livestream":null -> live false, label 'offline', dot 'ok' after subscription
// ChatKick_Viewers refresh: XHR 500 after 1200 -> viewers still 1200, state 'ok'   (Review Focus 3)
```

- [ ] **Krok 2:** Spustit testy, očekávaný pád.
- [ ] **Krok 3: Implementovat.**
  - `ChatKick_FetchChannel`: `404` → `'notfound'`, ostatní chyby kromě `0`/`403` → `'error'`. Retry zůstává.
  - `ChatKick_ChannelNative`: `404` → `'notfound'`, jiná chyba → `'error'`.
  - `ChatKick_Channel`: neplatný JSON nebo chybějící chatroom → `'error'`, úspěch → `SetViewers` z `ChatKick_ViewersOf`.
  - `subscription_succeeded` → `'ok'`, `onclose` → `'connecting'`.
- [ ] **Krok 4:** Spustit `node release/scripts/chat-multi-tests.js` a `node release/scripts/maker.js jsh`. Projde.
- [ ] **Krok 5:** Commit `Chat status bar: Kick state and viewers`.

### Task 5: Vydání Web 776 a ověření na TV

**Files:**
- Modify: `app/general/version.js` (`WebTag: 776`, `WebVersion`, changelog `Chat with linked YouTube / Kick chats: the bar above the chat shows total viewers and viewers, connection state and errors per platform`)
- Generated: `release/` (plná sestava)

- [ ] **Krok 1:** Zvýšit verzi a spustit `node release/scripts/maker.js`. Pak všechny harnessy z `AGENTS.md` kromě `phonechat-server-tests.js` (na tomto PC padá i na čistém `master`). Očekávané: všechny projdou.
- [ ] **Krok 2: Ověřit na TV** debug buildem s `up_assets.sh` (postup v `AGENTS.md`, potom `up_assets.sh 1` a `git checkout -- apk/app/src/main/java/com/fgl27/twitch/Constants.java`, `git status` bez build artefaktů).
  - Twitch stream s YouTube z adresáře (TenSterakdary, pokud vysílá): Twitch i YouTube jsou zelené s počty a součet sedí.
  - Ruční YouTube `Sterakdary`: červené `not found`.
  - Streamer s Kickem: Kick zelený s počtem.
  - Chat bez propojení vypadá jako dřív.
  - S vypnutým „show chatters“ se lišta u propojeného chatu ukáže.
  - Obraz v obraze: každý chat má svou lištu.
  - Screenshoty přes `adb exec-out screencap`.
- [ ] **Krok 3:** Commit `Release Web 776: chat status bar with viewers and link state per platform`. Squash merge do `master` a push až po souhlasu uživatele.
