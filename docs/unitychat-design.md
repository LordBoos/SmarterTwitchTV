# Sloučený chat z YouTube a Kicku (inspirace UnityChat) – design

Sepsáno 31. 10. 2026 pro Smarter Purple TV (SPTV). Dokument popisuje, **co** se má postavit a **proč**. Implementační plán z něj vznikne zvlášť.

## 1. Proč

Někteří streameři vysílají zároveň na Twitchi, YouTube a Kicku (např. `arcadebulls` na Twitch + YouTube, `robdiesalot` na Twitch + YouTube + Kick). Na Twitch streamu v SPTV je dnes vidět jen Twitch chat, takže divák nevidí zprávy z YouTube a Kicku, na které streamer reaguje.

V prohlížeči tohle řeší rozšíření [UnityChat](https://jouki.cz/UnityChat). Do TV aplikace ho vložit nejde, protože nemá embed, overlay ani veřejné API a je napsané jen pro tři streamery (`robdiesalot`, `mccitronlp`, `jouki728`). Funkci proto postavíme přímo v SPTV a z UnityChatu převezmeme jen jeho adresář propojených kanálů.

## 2. Cíle

- Při sledování Twitch streamu v přehrávači se do Twitch chatu průběžně přidávají zprávy z YouTube a Kick chatu téhož streamera. Řadí se podle příchodu, tedy prakticky podle času.
- Jde jen o čtení, z TV se do YouTube ani Kicku nepíše.
- U zpráv je vidět, ze které platformy pocházejí.
- Zprávy z YouTube a Kicku vypadají stejně plnohodnotně jako twitchové:
  - odznaky své platformy (moderátor, člen nebo předplatitel, vlastník, ověřený),
  - vlastní barvy nicků,
  - Super Chaty, členství a suby jako zvláštní řádky.
- Po otevření chatu se ukáže i historie posledních zpráv ze všech propojených platforem, seřazená podle času.
- Propojení „Twitch kanál → YouTube kanál / Kick kanál“ zjistí aplikace sama z adresáře UnityChatu. Uživatel ho může u každého streamera v přehrávači ručně přepsat nebo vypnout.
- Vydává se webová aktualizace **i nové APK**, které si uživatel rovnou nainstaluje na TV.

## 3. Mimo rozsah

- Přehrávání Kick streamů. Je to samostatný požadavek, řeší se později a zvlášť.
- Psaní do YouTube a Kick chatu, přihlašování k YouTube a Kicku.
- Telefonní chat (`app/PhoneChat/`, `PhoneChat.js`). Do telefonu se zprávy z YouTube a Kicku neposílají.
- VOD a klipy, protože pro ně není živý chat jiných platforem.
- Ostatní funkce UnityChatu: ankety, zvuky, odznaky UnityChatu, přezdívky, historie zpráv z jejich serveru. Historii stahujeme přímo z platforem, viz 6.9.
- Emoty z Twitche napsané jako text v YouTube nebo Kick zprávě (`Kappa`, subscriber emote). Zůstanou textem.

## 4. Co by bylo selháním, i kdyby to technicky fungovalo

- Twitch chat se zhorší: zpomalí se, zasekne nebo začne padat, protože YouTube nebo Kick nefunguje. Výpadek cizí platformy musí být tichý a nesmí ovlivnit Twitch chat ani přehrávání.
- Uživateli vyskakují chybové hlášky, když streamer na YouTube nebo Kicku zrovna nevysílá.
- Chat streamera bez propojení vypadá jinak než dnes.
- Cizí zpráva dokáže vložit HTML nebo skript do stránky (XSS). Jména i text z YouTube a Kicku jsou nedůvěryhodný vstup.

## 5. Rozhodnutí uživatele

1. Propojení kanálů se bere z adresáře UnityChatu a v nastavení ho jde ručně přepsat na vlastní hodnotu.
2. Sloučený chat je v **obou chatech přehrávače**: v hlavním (chat 0) i ve druhém (chat 1, tedy obraz v obraze a 50/50).
3. Jen čtení.
4. **Ikonka platformy je u každé zprávy včetně Twitch zpráv**, ale jen u streamera, který má propojený YouTube nebo Kick. U ostatních chat vypadá jako dnes. (Mockup varianta A, `ikonka-a`.)
5. **Ruční přepis se dělá v přehrávači**: v ovládání pod streamem přibude tlačítko „Propojené chaty“ pro právě sledovaný stream. (Mockup varianta A, `misto-a`.)
6. Emoty podle oddílu 6.5. Uživatel je odsouhlasil včetně omezení z oddílu 3.
7. YouTube zůstává u dotazování bez přihlášení. Oficiální API (`liveChatMessages.streamList`) s Google Cloud projektem je možné vylepšení na později, ne součást této verze.
8. **Vydává se i nové APK**, které si uživatel nainstaluje na TV. Bude stejně potřeba pro přehrávání Kicku. Pokud by ověření na zařízení ukázalo potřebu změny Java kódu, je to v pořádku.
9. **Odznaky platforem** u YouTube a Kick zpráv: role a předplatné nebo členství. Viz 6.4.
10. **Vlastní barvy nicků pro všechny platformy.** Viz 6.4.
11. **Super Chaty, Super Stickery a členství z YouTube, suby a darované suby z Kicku** se zobrazují. Viz 6.4.
12. **Historie** posledních zpráv ze všech platforem, pokud to jde. Jde to, viz 6.9.

## 6. Chování

### 6.1 Zjištění propojení

Pro Twitch kanál otevřený v chatu (`ChatLive_selectedChannel[chat_number]`, login malými písmeny) platí pro YouTube i Kick zvlášť:

1. Je-li celá funkce vypnutá v nastavení, nic se nenačítá.
2. Má-li uživatel u streamera propojení vypnuté, nic se nenačítá.
3. Má-li uživatel pro platformu ruční hodnotu, použije se ta. Prázdná ruční hodnota znamená „tuhle platformu nepropojovat“, i když ji adresář zná.
4. Jinak se použije hodnota z adresáře UnityChatu.

**Adresář UnityChatu** (nezdokumentované API, ověřeno 31. 10. 2026):

```
GET https://api.jouki.cz/streamers/lookup?platform=twitch&handle=<login>
→ 200 {"ok":true,"found":true,"streamer":{"twitchLogin","twitchUserId","youtubeHandle","youtubeChannelId","kickSlug","kickUserId","verified",...}}
→ 404 když streamera nezná
```

- Kterékoli pole může být `null`. Například `arcadebulls` má YouTube, ale `kickSlug: null`.
- `verified: false` se ignoruje a záznam se použije.
- Výsledek se cachuje v paměti po dobu běhu aplikace, včetně „nenalezeno“.
- Chyba nebo timeout adresáře se chová jako „nenalezeno“ a ruční hodnoty fungují dál.
- `POST /streamers/seen` ani nic jiného na jejich server neposíláme.

**Ruční hodnoty** se ukládají trvale v TV přes `Main_setItem` / `Main_getItemJson`, klíčované Twitch loginem. Na streamera se ukládá: zapnuto/vypnuto, YouTube (nevyplněno = z adresáře, prázdné = nepropojovat, jinak hodnota) a totéž pro Kick.

**Přijímané formáty ručního vstupu:**
- YouTube: handle (`arcadebulls` nebo `@arcadebulls`), ID kanálu (`UC…`, 24 znaků) nebo URL kanálu (`youtube.com/@…`, `youtube.com/channel/UC…`).
- Kick: slug nebo URL `kick.com/<slug>`.

Vstup se normalizuje a validuje. Neplatný vstup se neuloží.

### 6.2 Kick chat

Ověřeno 31. 10. 2026 na kanálu `robdiesalot`, ze stejného zdroje jako UnityChat (`core/kick.js`).

1. `GET https://kick.com/api/v2/channels/<slug>` vrátí `chatroom.id`, ID kanálu `id` (to se používá pro historii, viz 6.9) a `subscriber_badges[]` (`months`, `badge_image.src`). Pozor, Kick má tři různá čísla. U `robdiesalot` je to: kanál `92265443`, uživatel `93474300`, chatroom `91976532`. Odpověď je za Cloudflare. Z desktopu s Dalvik i Chrome User-Agentem vrací 200, z TV zatím ověřené není.
   - Kick posílá CORS pro origin aplikace (`access-control-allow-origin: https://yofardev.github.io`, ověřeno), takže požadavek může jít přímo z WebView přes XHR. WebView je skutečný Chromium a přes Cloudflare má lepší šanci než Java `HttpURLConnection`.
   - Primárně se proto použije XHR z WebView. `FullxmlHttpGet` je záloha.
2. WebSocket `wss://ws-<cluster>.pusher.com/app/<key>?protocol=7&client=js&version=8.3.0&flash=false`. Aktuálně `key=34bf7a0ff419a2a775b9`, `cluster=us2`.
   - Kick klíč 13. 10. 2026 vyměnil a starý klíč pak vracel chybu `4001`.
   - Aktuální klíč vrací i `GET https://api.jouki.cz/kick/realtime` jako `{"ok":true,"key":"…","cluster":"us2"}`. Použije se jako zdroj s vestavěnou zálohou.
3. Po `pusher:connection_established` se pošle `pusher:subscribe` na kanál `chatrooms.<chatroomId>.v2`.
4. Na `pusher:ping` se odpovídá `pusher:pong`.
5. Zprávy chodí jako událost `App\Events\ChatMessageEvent`. Název může přijít s prefixem `App\Events\` i bez něj, proto se porovnává bez prefixu. Pole `data` je JSON řetězec s těmito položkami:
   - `id`, `content`, `created_at`, `type`,
   - `sender.username`, `sender.identity.color`,
   - `sender.identity.badges[]`: role bez obrázku, např. `{type:"moderator"}`, `broadcaster`, `verified`, `vip`, `og`, `founder`, `sub_gifter` nebo `{type:"subscriber", count:10}`,
   - `sender.identity.badges_v2[]`: odznaky s obrázkem `{name, image_url:"https://ext.cdn.kick.com/chat/badges/…", selected}`.

   Ověřeno na historii `robdiesalot` a `xqc`. Že má živá zpráva stejný tvar, je převzato z UnityChatu.
6. Další události na téže Pusher sadě (názvy převzaté z UnityChatu, tvar ověřit na živých datech):
   - `SubscriptionEvent`: `username`, `months`,
   - `GiftedSubscriptionsEvent`: `gifter_username`, `gifted_usernames[]`,
   - `MessageDeletedEvent` a `UserBannedEvent` (viz moderace v 6.4).

   Pozor, UnityChat poslouchá suby a dary i na druhém kanálu `chatroom_<chatroomId>`. Kick je posílá i tam. Proto se odebírají oba kanály a události se deduplikují.
7. Emoty Kicku jsou v `content` jako `[emote:<id>:<name>]` a vykreslí se jako obrázek `https://files.kick.com/emotes/<id>/fullsize`. ID musí být číslo a URL se skládá v kódu.

Když Kick kanál nevysílá, chat stejně běží (Pusher doručí zprávy, i když se nevysílá), takže to nevadí. Po pádu spojení následuje reconnect s rostoucí prodlevou.

### 6.3 YouTube chat

Ověřeno 31. 10. 2026 na živém streamu `robdiesalot` (`UCROnsopSryzM2WaxxeNICOA`) bez prohlížeče, jen HTTP požadavky:

1. **Najít živé video:** `GET https://www.youtube.com/channel/<UCid>/live` (případně `https://www.youtube.com/@<handle>/live`, pokud ID kanálu neznáme).
   - Stream je živý, když HTML obsahuje některý ze znaků živého vysílání. Kontroluje se víc značek, jako to dělá UnityChat: `"isLiveNow":true`, `"isLive":true`. `videoId` je první `"videoId":"<11 znaků>"`.
   - Jedna značka nestačí. Při testu jednou `/channel/<UCid>/live` neobsahoval `"isLiveNow":true`, přestože `/@robdiesalot/live` ve stejnou chvíli ano.
   - Když má kanál víc živých streamů najednou (např. vodorovný a svislý), sleduje se ten, který vrátí `/live`.
   - **Požadavky musí mít desktopový User-Agent** (Chrome). S výchozím Dalvik UA YouTube přesměruje na `m.youtube.com` a stránka má jiný tvar.
   - Posílá se i `Cookie: SOCS=CAI` jako pojistka proti přesměrování na stránku se souhlasem s cookies (`consent.youtube.com`). Z ČR k přesměrování nedošlo ani bez ní.
2. **Načíst stránku chatu:** `GET https://www.youtube.com/live_chat?is_popout=1&v=<videoId>`. Z HTML se vytáhnou:
   - `INNERTUBE_API_KEY`,
   - `INNERTUBE_CONTEXT`,
   - počáteční token z `invalidationContinuationData.continuation`, případně `timedContinuationData.continuation`.
   - Stránka obsahuje i ~30 posledních zpráv (`ytInitialData`, stejný tvar akcí jako v kroku 4). Ty tvoří historii YouTube, viz 6.9.
3. **Dotazovat se každou ~1 s:** `POST https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=<key>&prettyPrint=false` s tělem `{"context":<INNERTUBE_CONTEXT>,"continuation":<token>}`.
   - Odpověď vrací zprávy od minulého dotazu a další token v `continuations[0]`. Ten se použije v dalším dotazu.
   - Ověřeno souběžným testem na rušném chatu: tento řetězec vrátil stejné zprávy jako opakované stažení „posledních 30“ (13 z 13).
   - Doporučený interval `timeoutMs` (10 s) je horní mez, smí se ptát častěji.
   - **Naměřeno při dotazu každou 1 s:** 41 dotazů bez chyby, ~2 KB na odpověď, zpráva dorazila 2,4–3,4 s po odeslání (medián 2,7 s). Při intervalu 5 s byl medián 6,1 s a maximum 7,4 s. Asi 2,4 s zpoždění přidává sám YouTube.
   - Když řetězec selže nebo token chybí, znovu se načte stránka chatu (krok 2).
   - Zprávy z jedné odpovědi se seřadí podle `timestampUsec`. Volitelně se rozprostřou v rámci intervalu podle rozdílů časů, aby nepřicházely po dávkách.
4. **Zprávy:** `continuationContents.liveChatContinuation.actions[].addChatItemAction.item.<renderer>`.
   - **`liveChatTextMessageRenderer`** (běžná zpráva):
     - `id`, `timestampUsec`, `authorName.simpleText`, `authorExternalChannelId`,
     - `message.runs[]`, kde je buď `text`, nebo `emoji` s `image.thumbnails[].url` a `shortcuts`,
     - `authorBadges[].liveChatAuthorBadgeRenderer`: buď `icon.iconType` (`OWNER`, `MODERATOR`, `VERIFIED`, ověřeno `OWNER` a `VERIFIED`), nebo `customThumbnail.thumbnails[]` (odznak člena kanálu jako obrázek), a `tooltip`.
   - **Zvláštní položky**, které se zobrazují (viz 6.4). Názvy podle známého tvaru YouTube, na živých datech ověřit:
     - `liveChatPaidMessageRenderer`: Super Chat, `purchaseAmountText.simpleText`, volitelně `message.runs`, barva `bodyBackgroundColor`,
     - `liveChatPaidStickerRenderer`: Super Sticker, částka a obrázek nálepky,
     - `liveChatMembershipItemRenderer`: nový člen nebo milník členství, `headerPrimaryText` / `headerSubtext`, volitelně `message`,
     - `liveChatSponsorshipsGiftPurchaseAnnouncementRenderer`: darovaná členství,
     - `liveChatSponsorshipsGiftRedemptionAnnouncementRenderer`: přijaté darované členství.
   - Ostatní typy (systémové zprávy, `liveChatViewerEngagementMessageRenderer`) se ignorují. Pozor na systémový banner „pravidla komunity“: ten při každém dotazu dostane nové `id`.
5. Když stream nevysílá nebo cokoli z kroků 1–3 selže, zkusí se to znovu za 2 minuty, dokud je chat otevřený. Streamer mohl na YouTube začít vysílat později.

Tohle je nejkřehčí část a YouTube ji může kdykoli změnit. Když se rozbije, YouTube zprávy prostě nechodí a nic dalšího se neděje.

### 6.4 Zobrazení zpráv

- Zprávy z YouTube a Kicku jdou stejnou cestou jako Twitch zprávy: `ChatLive_LineAddCheckDelay(chat_number, messageObj)`. Dostanou tak stejné zpoždění chatu, pauzu, slučování spamu, promazávání i animace.
- **Ikonka platformy** (Twitch, YouTube, Kick) je malý obrázek před odznaky a jménem, ve velikosti stávajícího `.tag` (1,4 em). Je u každé zprávy, Twitch zpráv i historie, ale jen pokud má aktuální kanál v daném chatu platné propojení alespoň na jednu cizí platformu. Nezáleží na tom, jestli cizí platforma zrovna vysílá. Ikonky jsou malé SVG nebo PNG v repozitáři a nenačítají se zvenku.
- **Odznaky platformy** jsou hned za ikonkou platformy a před jménem, stejně velké jako Twitch odznaky. Obrázky se skládají v kódu nebo se berou jen z ověřených domén:
  - **YouTube:**
    - vlastník, moderátor a ověřený (`iconType`) jako malé ikonky přibalené v repozitáři,
    - odznak člena z `customThumbnail` (domény YouTube jako u emoji).
  - **Kick:**
    - role z `badges[]` (broadcaster, moderator, vip, og, founder, verified, sub_gifter, staff) jako ikonky přibalené v repozitáři,
    - předplatitel jako obrázek z `subscriber_badges` kanálu: odznak s nejvyšším `months` ≤ `count`, nebo výchozí ikonka, když kanál vlastní nemá,
    - `badges_v2` se `selected: true` jako obrázek z `ext.cdn.kick.com`.
  - Neznámý typ odznaku se vynechá.
- **Barva jména** se řídí stávajícím nastavením **„Readable nick colors“** (`chat_nickcolor`) stejně pro všechny platformy:
  - **Zapnuto:** paleta aplikace (`defaultColors`) přepíše barvy všech platforem, tedy Twitch, Kick i barvy rolí YouTube. U Twitche je to stejné jako dnes. Barvy zvýraznění (streamer, moderátor, zmínka) zůstávají jako dnes.
  - **Vypnuto:** vlastní barva z platformy.
    - Twitch: `tags.color`, jako dnes.
    - Kick: `sender.identity.color`, pokud je to platná hex barva.
    - YouTube nemá barvy uživatelů, jen barvy rolí. Použijí se barvy jako na YouTube: vlastník žlutě, moderátor modře, člen zeleně. Ostatní dostanou paletu aplikace.
- **Zvláštní řádky** (Super Chat, Super Sticker, členství, darovaná členství, Kick sub a darované suby) vypadají jako dnešní Twitch sub oznámení (`ChatLive_CheckIfSub` / `ChatLive_CheckIfSubSend`) a řídí se stejným nastavením zobrazení subů (`show_sub`).
  - Super Chat a Super Sticker ukazují částku. Super Chat je podbarvený barvou z YouTube (`bodyBackgroundColor`) nebo zvýrazněný jako Twitch zpráva s bity.
  - Text zprávy u Super Chatu a milníku členství projde stejným zpracováním emotů jako běžná zpráva.
- **Escapování:** jméno i text se vždy escapují. Nesmí se použít cesta `ChatLive_loadChatSuccess`, která některé atributy vkládá bez escapování.
- **ID řádků** dostanou prefix platformy (`yt_`, `kick_`), aby se nekřížila s Twitch `CLEARCHAT` / `CLEARMSG`.
- **Moderace se přebírá stejně jako u Twitche** a řídí se stávajícím nastavením mazání chatu (smazat / nechat zašedlé). Proto si řádek nese ID zprávy a ID autora s prefixem platformy.
  - YouTube posílá v téže odpovědi `markChatItemAsDeletedAction` (`targetItemId`), `markChatItemsByAuthorAsDeletedAction` (`externalChannelId`) a `removeChatItemAction`.
  - Kick posílá na téže Pusher sadě `MessageDeletedEvent` a `UserBannedEvent`.
  - Přesné názvy polí je potřeba ověřit na živých datech.
- Zvýraznění funguje stejně jako u Twitche, pokud je na cizí platformě rozpoznatelné:
  - zpráva od streamera: YouTube `OWNER`, Kick `broadcaster`,
  - zpráva od moderátora,
  - zmínka streamera (`@<jméno>` podle jména na dané platformě).

  Ostatní zvýraznění (první zpráva, bity) se pro cizí zprávy nepoužívají.

### 6.5 Emoty

- **Twitch zprávy:** beze změny.
- **Kick zprávy:**
  - `[emote:id:name]` → obrázek z `files.kick.com`,
  - zbytek textu projde stejným zpracováním jako Twitch, tedy `ChatLive_extraMessageTokenize(emoticonize(text, null), chat_number, 0)`. Ten escapuje a přidá BTTV, FFZ a 7TV emoty Twitch kanálu, které už jsou načtené v `extraEmotes[chat_number]`.
- **YouTube zprávy:**
  - běh `emoji` → obrázek z `image.thumbnails` (vybrat rozumnou velikost, URL z domén `yt3.ggpht.com` / `*.googleusercontent.com` / `www.youtube.com`, jiné se zahodí a místo nich se ukáže `shortcuts[0]` jako text),
  - běh `text` → stejné zpracování jako u Kicku.
- 7TV sada se bere z Twitch kanálu. U `robdiesalot` vrací 7TV pro Twitch i Kick identickou sadu (525 emotů). Pro YouTube 7TV podle ID kanálu nevrací nic (`invalid platform`).

### 6.6 Kde to běží

- Zdroje (YouTube, Kick) se spouštějí a ukončují **na číslo chatu** (0 a 1) spolu s Twitch chatem:
  - start v `ChatLive_Init`,
  - konec v `ChatLive_Clear` / `ChatLive_Close`,
  - přepojení při `ChatLive_Switch`.
- Každá asynchronní odpověď se zahodí, pokud se mezitím změnilo `Chat_Id[chat_number]`.
- Ve čtyřech streamech najednou chat 0 sleduje vybraný stream, takže se cizí zdroje přepojí s ním.
- Nejvýš tedy běží 2× YouTube polling a 2× Kick websocket.
- Funguje jen pro živé streamy v přehrávači.

### 6.7 Dialog „Propojené chaty“

- Nové tlačítko v ovládání přehrávače pod streamem (`Play_controls`, vzor třeba `Play_controlsChatDisShared` v `PlayEtc.js`). Platí pro stream, jehož chat je právě aktivní (chat 0).
- Dialog podle mockupu:
  - nadpis „Propojené chaty – <jméno streamera>“,
  - řádek **YouTube** s aktuální hodnotou a jejím původem („z UnityChatu“, „ručně“, „nenalezeno“) a akcí Upravit / Zadat,
  - řádek **Kick** stejně,
  - řádek **„Propojení pro tohoto streamera“** Zapnuto / Vypnuto.
  - Volitelně akce „Vrátit na UnityChat“ u ručně zadané hodnoty.
- Text se zadává klávesnicí, kterou aplikace už má (vyhledávání `index.html:3997`, psaní do chatu `index.html:4852`).
- Po uložení se cizí zdroje v chatu hned přepojí.
- Mockup: `ikonky-a-propojeni.html` z brainstormingu, varianty A.

### 6.8 Nastavení

V nastavení chatu (`Settings_value`, `Settings_DialogShowChat`) přibude jedna položka „Chat z YouTube a Kicku“ (ne / ano), výchozí **ano**. Vypnutí zastaví zdroje a skryje ikonky. Řetězce patří do `app/languages/en_US.js` a ostatní jazyky podle konvence `untranslated` v README.

### 6.9 Historie

Po otevření chatu se do bloku historie, který dnes plní Twitch z robotty (30 zpráv, `ChatLive_PreLoadChat`, `addToStart`), přidají i poslední zprávy z YouTube a Kicku. Všechny se **proloží podle času odeslání**.

- **Twitch:** beze změny. Čas je v `tmi-sent-ts`.
- **Kick:** `GET https://kick.com/api/v2/channels/<ID kanálu>/messages` (ID kanálu = `id` z kroku 1 v 6.2, **ne** user ID ani chatroom ID). Vrací `data.messages[]` (ověřeno: 23 zpráv u `robdiesalot`, 25 u `xqc`) ve stejném tvaru jako živé zprávy a s `created_at`. Posílá CORS pro origin aplikace. Záloha je `https://web.kick.com/api/v1/chat/<ID kanálu>/history`, která vrací stejná data.
- **YouTube:** ~30 zpráv přímo ze stránky chatu (krok 2 v 6.3), čas v `timestampUsec`. Pokud stream nevysílá, historie YouTube není.
- **Pořadí a pozdní příchod:** historie jednotlivých platforem dorazí v různou dobu. Každý řádek historie proto nese čas a pozdě doražená historie se vloží na správné místo mezi už zobrazené řádky historie. Živé zprávy, které mezitím přišly, zůstanou až za historií.
- **Duplicity:** zpráva, která přijde v historii i živě, se zobrazí jen jednou (deduplikace podle ID zprávy na platformě).
- Historie respektuje stejná pravidla jako živé zprávy (ikonky, odznaky, barvy, smazané zprávy v historii YouTube se nezobrazí).

## 7. Technické podklady (ověřeno v kódu)

- **HTTP bez CORS:** `FullxmlHttpGet(url, headers, ok, err, key, checkResult, method, body)` (`Main.js:2224`) jde přes Javu (`RequestDispatcher`, `HttpURLConnection`).
  - Umí libovolnou metodu, hlavičky (včetně `User-Agent` a `Cookie`) i tělo.
  - Callbacky musí být pojmenované top-level funkce, protože se volají podle jména.
  - `key` a `checkResult` jsou čísla. Hodí se na ně `chat_number` a `Chat_Id`.
  - Síťová chyba přijde jako `status: 0` v úspěšném callbacku.
  - V desktopovém Chrome se požadavek vrací k XHR a CORS ho zablokuje. YouTube a Kick API je proto nutné testovat na zařízení nebo emulátoru.
- **WebSocket:** JS v WebView otevírá libovolné `wss://` (už dnes Twitch IRC a EventSub). CSP není.
- **Funkce sama podle dostupných informací Java změny nepotřebuje** ani změnu `release/api.js` (`Main_CheckFullxmlHttpGet` je exportované).
  - Kdyby ověření na zařízení ukázalo, že YouTube nebo Kick požadavky z `HttpURLConnection` odmítají, změní se Java část, například jiným HTTP klientem nebo požadavkem přes skrytý WebView.
- **Sestavení APK** vyžaduje Android Studio a klon https://github.com/fgl27/media jako sourozeneckou složku `media/` (viz `AGENTS.md`, `apk/Media3 changes.md`). Na tomto stroji `E:\Projects\Private\SmarterTwitchTV\media` zatím **není**.
- Pro test na TV před nasazením webu se APK sestaví s webem přibaleným v assets: `release/scripts/up_assets.sh` nastaví `LoadFromAssets = true`. Pro vydání se to vrátí zpět přes `up_assets.sh 1`.
- **ES5:** cílí na staré TV WebView, takže bez arrow funkcí, `let/const`, `class`, `fetch` a template literals. JSHint (`node release/scripts/maker.js jsh`) musí projít.
- Nový kód ideálně v samostatném souboru v `app/specific/`, aby testovací sandbox `chat-optimization-tests.js`, který načítá jen `ChatLive.js`, zůstal funkční. Záleží na pořadí načítání.

## 8. Moje rozhodnutí (autor designu, ne uživatel)

- Pořadí zpráv podle příchodu, ne podle časového razítka platformy. Twitch (IRC) a Kick (Pusher) doručují zprávy okamžitě přes websocket. YouTube nemá pro anonymního klienta žádný použitelný push, takže jeho zprávy chodí ~2,5–3,5 s po odeslání. Je to menší rozdíl, než jaký je mezi zpožděním videa jednotlivých platforem.
- YouTube polling každou ~1 s (naměřeno ~2 KB na dotaz).
- Moderace (mazání zpráv a bany) se z YouTube i Kicku přebírá jako u Twitche.
- U víc souběžných YouTube streamů jednoho kanálu se sleduje ten, který vrátí `/live`.
- Opakovaný pokus o YouTube každé 2 minuty, když stream nevysílá.
- Pusher klíč Kicku z `api.jouki.cz/kick/realtime` s vestavěnou zálohou.
- Cache adresáře jen v paměti po dobu běhu aplikace.
- Vlastní barvy nicků se řídí stávajícím nastavením „Readable nick colors“ stejně pro všechny platformy. YouTube místo barev uživatelů použije barvy rolí jako na YouTube.
- Zvláštní řádky (Super Chat, členství, Kick suby) se řídí stávajícím nastavením zobrazení subů.
- Zvýraznění streamera, moderátora a zmínky streamera platí i pro cizí zprávy.
- Kick odznaky `badges_v2` se zobrazují jen se `selected: true`.
- Systémové zprávy YouTube se nezobrazují.

## 9. Ponecháno na implementaci

- Rozdělení do souborů a názvy funkcí.
- Přesná podoba a pozice tlačítka v ovládání a vzhled dialogu v rámci stylu aplikace.
- Výběr velikosti YouTube emoji obrázků.
- Prodlevy reconnectu Kicku.
- Ikonky platforem a rolí (YouTube vlastník, moderátor a ověřený, Kick role). Vlastní jednoduché SVG nebo PNG v repozitáři, ve stylu odznaků Twitche.
- Přesný vzhled zvláštních řádků v rámci stylu sub oznámení.

## 10. Ověření

- **Úplně první krok je ověření na zařízení.** Na skutečné Android TV (nebo emulátoru) se ověří, že z aplikace projdou volání adresáře, Kick API, Pusher websocketu a YouTube (krok 1–3 z 6.3). Teprve potom se staví zbytek. Když něco neprojde, řeší se to nejdřív (případně změnou APK, viz oddíl 7). Z desktopového Chrome to otestovat nejde, protože `FullxmlHttpGet` tam spadne na XHR a CORS ho zablokuje.
- Testovací harness v `release/scripts/` (vzor: existující `*-tests.js`, bez frameworku), který pokrývá:
  - rozhodování o propojení z oddílu 6.1, včetně prázdné ruční hodnoty a vypnutého streamera,
  - normalizaci ručního vstupu,
  - převod Kick zprávy a YouTube runs na HTML včetně escapování (XSS vstup) a odmítnutí cizích URL obrázků,
  - odznaky a barvy jmen pro obě hodnoty „Readable nick colors“,
  - zvláštní řádky (Super Chat, členství, Kick sub a dar),
  - proložení historie tří platforem podle času, včetně pozdě doražené historie a deduplikace proti živým zprávám,
  - deduplikaci YouTube podle `id`.
- `node release/scripts/maker.js jsh`, plná sestava `node release/scripts/maker.js` a stávající harnessy (`chat-optimization-tests.js` a další) projdou.
- Na zařízení (nebo emulátoru) s živým streamem `robdiesalot`, kde je vidět Twitch + YouTube + Kick:
  - zprávy ze všech tří platforem s ikonkami,
  - funkčnost v chatu 1 (obraz v obraze, 50/50),
  - přepis v dialogu a vypnutí v nastavení.
- `arcadebulls` (YouTube, ne Kick), když vysílá.
- Kanál bez propojení: chat beze změny, bez ikonek.

## 11. Vydání

Vydání APK i webu podle `AGENTS.md`:

- `publishVersionCode` +1 v `app/general/version.js` i `apk/versions.gradle`,
- aktualizovat `ApkUrl`,
- záznam do changelogu v `version.js` a stejný v `apk/Changelog.md`,
- `WebTag` +1 a datum `WebVersion`,
- plná sestava `node release/scripts/maker.js` a commit vygenerovaného `release/`,
- sestavení APK (bez `LoadFromAssets`).

Push na GitHub (tím se nasadí web přes GitHub Pages) a zveřejnění APK proběhnou až se souhlasem uživatele.
