# Lišta nad sloučeným chatem: diváci podle platforem a stav propojení – design

Sepsáno 3. 11. 2026 pro Smarter Purple TV (SPTV). Navazuje na sloučený chat (`docs/unitychat-design.md`) a Kick jako druhou platformu (`docs/kick-design.md`). Dokument popisuje, **co** se má postavit a **proč**. Implementační plán z něj vznikne zvlášť.

## 1. Proč

Nad chatem je dnes jednořádkový údaj, např. „553 In Chat“. Ten se týká jen Twitche. U streamera s propojeným YouTube nebo Kick chatem uživatel nevidí:

- kolik lidí stream sleduje na ostatních platformách,
- jestli se propojené chaty vůbec připojily.

Spouštěcí případ (3. 11. 2026): u TenSterakdaryho byl v dialogu „Linked chats“ ručně zadaný neexistující YouTube kanál (`Sterakdary` je zobrazované jméno, skutečný handle je `@TenSterakdary`). Aplikace každé 2 minuty tiše zkoušela neexistující kanál, YouTube zprávy nechodily a nic v UI to neprozradilo. Na příčinu se přišlo až po ladění na zařízení.

## 2. Cíle

- U chatu s propojenými platformami ukáže lišta nad chatem **celkový počet diváků a počet diváků na každé platformě**.
- U každé platformy je vidět **stav propojení**: připojeno, připojuje se, nevysílá, chyba. U chyby je i krátký důvod.
- Uživatel na první pohled pozná rozbité propojení, například neexistující kanál.

## 3. Mimo rozsah

- Počet lidí v chatu (chatters) u YouTube a Kicku. Platformy ho nezveřejňují, všude se proto počítají diváci.
- Klikání na lištu, detail nebo historie počtů. Lišta je jen pro čtení.
- Úpravy dialogu „Linked chats“. Stav se ukazuje jen v liště.
- Toasty, vyskakovací hlášky a systémové řádky v chatu o chybě propojení (varianta C byla zamítnuta).
- Lišta u chatu bez propojených platforem. Ta zůstává přesně jako dnes.
- Telefonní chat.

## 4. Co by bylo selháním, i kdyby to technicky fungovalo

- Lišta tvrdí „připojeno“, i když zdroj tiše selhává. Hlavním smyslem je, aby se to neopakovalo.
- Lišta skáče, mění výšku nebo bliká a posouvá chat.
- Kanál, který jen nevysílá, vypadá jako chyba (červeně).
- Chyba nebo pomalost YouTube či Kicku zpomalí nebo rozbije Twitch chat nebo přehrávání (stejné pravidlo jako u sloučeného chatu).
- Chat bez propojených platforem vypadá jinak než dnes.

## 5. Rozhodnutí uživatele

- **Varianta B** z návrhů:
  - 1. řádek: celkový počet diváků, např. `1,753 viewers`,
  - 2. řádek: každá platforma zvlášť (ikonka platformy, počet diváků a barevná tečka stavu), u chyby místo počtu krátký důvod.
- **Všude diváci**, ne lidi v chatu, a to i u Twitche, když je chat propojený.
- Dvouřádková lišta se ukáže **jen u chatu, který má propojené platformy**. Bez propojení zůstává lišta jako dnes a řídí se nastavením „show chatters“ (lidi v chatu / diváci / vypnuto).
- U chatu s propojenými platformami se dvouřádková lišta ukáže **i při vypnutém „show chatters“**. Stav propojení je důležitější než místo v chatu. Platí to i pro Kick stream s propojenými platformami.
- **Barvy stavu**:
  - zelená: připojeno,
  - žlutá: připojuje se,
  - šedá s textem `offline`: kanál existuje, ale nevysílá (není to chyba a po začátku vysílání sama zezelená),
  - červená s důvodem: chyba. `not found`, když kanál neexistuje, `error` při chybě sítě nebo API.
- Počty se obnovují **jednou za minutu**.
- Pořadí platforem: platforma streamu první (Twitch stream: Twitch, Kick, YouTube; Kick stream: Kick, Twitch, YouTube).
- V režimu obraz v obraze a 50/50 má **každý chat svou lištu**.

## 6. Ověřená fakta o zdrojích dat

Ověřeno 3. 11. 2026 proti živým kanálům.

- **Twitch:** Helix `streams?user_id=<id>` (hlavní kanál, už se volá v `ChatLive_loadChattersViewers`) nebo `streams?user_login=<login>` (Twitch propojený ke Kick streamu). `viewer_count`. Prázdné `data` = nevysílá.
- **YouTube:** `POST https://www.youtube.com/youtubei/v1/updated_metadata?prettyPrint=false&key=<INNERTUBE_API_KEY>` s tělem `{context, videoId}`. Klíč a kontext jsou ty, které už `ChatYouTube` má ze stránky chatu. Počet je v `actions[].updateViewershipAction.viewCount.videoViewCountRenderer.originalViewCount` jako číselný řetězec (`"513"`), nezávislý na jazyce. `simpleText` je lokalizovaný (`Právě sleduje: 513`) a nepoužívat. Dotaz musí jít přes `FullxmlHttpGet` (YouTube neposílá CORS), stejně jako polling chatu.
- **Kick:** `GET https://kick.com/api/v2/channels/<slug>`, pole `livestream.viewer_count`. `livestream: null` = nevysílá. `ChatKick` tuto odpověď už stahuje při startu (`ChatKick_Channel`), pro obnovu jednou za minutu je potřeba ji stahovat znovu.

## 7. Co znamená který stav

Tečka vyjadřuje stav **připojení chatu** dané platformy. Text vedle ní je počet diváků, `offline` nebo důvod chyby.

| Platforma | připojuje se | připojeno | offline | not found | error |
| --- | --- | --- | --- | --- | --- |
| YouTube | od startu do prvního úspěšného načtení stránky chatu, a znovu po přerušení řetězce pollingu | stránka chatu načtená a poslední poll úspěšný | `/live` vrátil 200, ale bez živého videa | `/live` vrátil 404 | jiný status, síťová chyba (`status: 0`), stránka chatu nejde rozparsovat |
| Kick | do připojení websocketu | websocket přihlášený k chatroomu | `livestream: null` (chat může být připojený i offline, tečka je pak zelená a text `offline`) | `v2/channels/<slug>` vrátil 404 | ostatní chyby kanálu nebo websocketu |
| Twitch | do připojení IRC | IRC připojené ke kanálu | Helix `streams` prázdné | kanál neexistuje (Helix `users`) | chyba IRC nebo Helixu |

YouTube nemá chat, když kanál nevysílá. U něj je tedy `offline` vždy šedá tečka. Kick a Twitch mají chat i bez vysílání: když je chat připojený a kanál nevysílá, je tečka zelená a text `offline` (rozhodnutí při návrhu, upřesňuje „offline = šedá“ z kapitoly 5).

**Počet diváků a stav připojení jsou dvě různé věci** (rozhodnutí při návrhu):

- Tečka se řídí jen připojením chatu.
- Selhání obnovy počtu jednou za minutu tečku nemění, zůstane poslední známý počet. Když počet ještě nikdy znám nebyl, ukazuje se `...`.
- Červená je jen při skutečném selhání chatu, tedy u sloupců `not found` a `error` výše.
- Kick při startu z `v2/channels/<slug>` bere chatroom i počet. Selhání tohoto prvního dotazu (včetně 403 od Cloudflare) je chyba chatu. Selhání pozdějších obnov počtu chybou není.
- Twitch „chyba Helixu“ v tabulce platí jen pro zjištění existence kanálu, ne pro obnovu počtu.

Celkový počet je součet platforem, u kterých počet známe. Dokud není znám žádný, ukazuje se `...` jako dnes.

## 8. Omezení

- Kód webu je ES5 pro staré TV WebView, bez modulů, vše v jednom globálním prostoru (viz `AGENTS.md`).
- Callbacky `FullxmlHttpGet` se volají podle jména, musí to být pojmenované funkce na nejvyšší úrovni. Síťová chyba přijde jako `status: 0` v úspěšném callbacku.
- Každá asynchronní cesta musí kontrolovat číslo relace (`ChatMulti_IsActive`) jako ostatní zdroje sloučeného chatu. Po zavření nebo přepnutí chatu se nesmí nic dopsat do lišty a obnova jednou za minutu musí skončit spolu s relací (`ChatMulti_Stop`, `ChatLive_Clear`).
- Data z YouTube a Kicku jsou nedůvěryhodná. Počet se bere jen jako nezáporné celé číslo, nic z odpovědi se nevkládá jako HTML.
- Výška lišty je dnes ve `vh` (`.chat_loggedin`, `font-size: 2.5vh`, `height: 2.8vh`). Výška chatu pod ní se počítá v `ChatLive_loadChatters` (`chat_box_holder` `calc(100% - 2.9vh)`). Dvouřádková lišta musí mít pevnou výšku po celou dobu relace, aby chat neposkakoval.
- Jestli má chat propojení, se ví až v `ChatMulti_OnLinks` po dotazu na adresář (rozhodnutí při návrhu). Lišta proto začíná jako dnes, tedy jednořádková. **Jednou** se přepne na dvouřádkovou, když se propojení zjistí. Stejně jednou se přepne při změně propojení v dialogu (`ChatMulti_Restart`) nebo při vypnutí sloučeného chatu. Jiné změny výšky nejsou.
- Kick stream dnes lištu vůbec nemá (`ChatLive_Init` u Kick řádku `loadChatters` nevolá). Kick stream s propojenými platformami ji dostane, bez propojení zůstane bez lišty.
- Nové texty patří do `app/languages/en_US.js` a záznamu v `app/languages/untranslated/untranslated_ui_js.txt`. Čeština v aplikaci není.
- Testy: rozšířit `release/scripts/chat-multi-tests.js` (stavy, součet, parsování počtů). Vydání je jen webové (Web 776), APK se nemění.

## 9. Na stavitelovi

- Rozdělení kódu do souborů (nový soubor, nebo rozšíření `ChatMulti.js`), přesný tvar stavového objektu a jak zdroje hlásí změny.
- Přesné CSS, velikosti a odstíny barev, pokud odpovídají variantě B a nezvětšují lištu víc než o jeden řádek.
- Formát čísel (`Main_formatNumber`, zkracování na `1.2K` u úzkého chatu v obraze v obraze).
- Plánování obnovy počtů (jeden časovač na chat, nebo na zdroj) a jak se obnovuje Twitch počet, který dnes běží po 5 minutách.
- Přesné znění krátkých důvodů v angličtině (`not found`, `offline`, `error` jsou výchozí návrh).
