# Kick as a second platform: implementation results

## Ráno

### Co je hotové

- Všechny úlohy plánu (1–16) jsou hotové a prošly review, finální review celé větve má opravenou vlnu nálezů. Větev `feature/kick` není pushnutá, nic se nevydalo ani neslučovalo.
- Kick funguje vedle Twitche: živé streamy s kvalitami a reconnectem, VOD s posunem a pamatovanou pozicí, klipy, stránka kanálu, Kick chat s historií a připojeným Twitchem a YouTube, 50/50, PiP a 4-way v libovolné kombinaci Twitch/Kick, historie, Kick účet připojený k LordBoos i samostatný Kick uživatel, sloučené Following, panel v přehrávači a boční panel, procházení a vyhledávání s přepínačem Twitch / Kick.
- Navíc z noci: oprava Nastavení a překrývání obrazovek (úloha 15), 4-way na této TV díky dvěma softwarovým dekodérům v 480p (úloha 16).
- Akceptace na TV proběhla na finálním kódu: **26 prošlo (1 z toho až po opravě), 0 neprošlo, 3 zaparkováno**. Podrobnosti jsou v oddílu „Akceptace na TV“.
- Na TV je debug APK z posledního stavu kódu (commit `2c5ebc636`), TV je na Following jako LordBoos s připojeným Kickem, bez otevřeného přehrávače, přepínač procházení je na Twitchi. Uspávání TV je vrácené (`sleep_timeout` 1800000, `screen_off_timeout` 600000).

### Co je zaparkované a proč

Drobnosti, které finální review nechalo na později (kosmetika, upstream nebo bez dopadu na uživatele):

- Dvojité escapování `aria-label` u Kick karet a kategorií (úlohy 1 a 10) – jen čtečka obrazovky, plán to tak předepsal.
- Klip s nebezpečným slugem kanálu ztratí jen odkaz na kanál (úloha 1).
- Kick hlavní chat: automatické zpoždění chatu nemá průběžný zdroj latence, Kick ikonky zůstanou viditelné, když se připojený Twitch vzdá, jeden řádek „Chat delay“ navíc (úloha 3).
- Odpověď 200 s tělem, které není JSON, vyhodí výjimku – stejně jako dřív u Twitche (úloha 4).
- Na Kick stránce kanálu jsou vidět přepínače „VODs or highlights“ a „Most recent or views“, pro Kick nic nedělají (úlohy 4 a 15).
- Mezery v testech (`PlayVod_PosStart`, kreslení průběhu u Kick VOD) – kód ověřený na TV (úloha 5).
- Kick živé položky v historii mají místo náhledu zástupný obrázek, protože náhled z `v2/channels` buď chybí, nebo odpovídá 403 (úloha 6). Stejný důvod měl i nález finálního review M3, ten je teď opravený (viz níž).
- Po prohození Kick PiP do hlavního okna zůstane do další obnovy informací starý příznak partnera, `releasePlayer` nikdy nevolá `setPlayer(null)` – upstream, neškodí (úloha 6).
- AGame ukazuje „Sign in“ i Twitch uživateli bez tokenu, test WAF pokrývá jen status 0, zastaralé `kickPending` (úloha 8).
- Vyhledávání živých streamů na Kicku vrací nejvýš 20 výsledků (limit API), záložka Videa nemá přepínač (úloha 11).
- Když selže kontrola sledování, tlačítko ukáže „Follow“ i u sledovaného kanálu (úloha 12).
- Psaní do Kick chatu: neúspěšné odeslání smaže napsaný text, varování není vidět při zavřeném vstupu, v PiP se smíšenými platformami rozhoduje jen primární chat, bez limitu délky (úloha 13).
- Upstream překryvy rozvržení z úlohy 15 (redesign TV rozhraní, platí i pro Twitch): tlačítko „…“ na kartě zakrývá konec dlouhého titulku, titulky PiP vedou pod panel Kvalita, spodní řádek panelu v přehrávači je pod chatem.
- **Finální review M3** (Kick stream bez náhledu se nezapíše do historie) – v noci zaparkované, protože nebylo jasné, jak často to nastává. Akceptace ukázala, že často: v 10:33 nemělo 3 z 8 nejsledovanějších Kick streamů v `v2/channels` žádný náhled. **Opraveno v úloze 14** (commit `2c5ebc636`) a ověřeno na TV.
- **T16 M2:** Twitch kanál bez překódovaných kvalit (jen source) by v softwarovém slotu 4-way dekódoval plné rozlišení – limit 480p nemá nižší kvalitu, kterou by vybral. V noci se nestalo, všechny měřené streamy měly 480p.
- **T16 M3:** softwarové sloty 4-way záměrně obcházejí seznam blokovaných kodeků, ale Nastavení dál ukazuje `c2.android.avc` jako zakázaný. Může to mást, funkčně je to v pořádku.
- **Nové z akceptace (upstream nebo nejisté, jen k posouzení):** prostřední varování (např. „Kick sign in expired…“) je zčásti schované pod videonáhledem zaměřené karty; ve 4-way se slot zavře, když HLS hlásí konec streamu, bez nové kontroly, jestli kanál ještě vysílá (stejná upstream cesta jako u Twitche, v noci šlo o skutečný konec streamu); po restartu aplikace obnovené na Kick stránce kanálu ukazuje hlavička „Following / Live now“ (nezjištěno, jestli totéž dělá Twitch kanál).
- **Akceptace D** (follow/unfollow, psaní do chatu) a **záloha na Google Drive** – viz ranní kontrola a tabulka akceptace.

### Rozhodnutí přijatá v noci

Plné znění je v ledgeru plánu (řádky „Ruling N“). Každé má cenu, kdyby bylo špatně:

1. Model: opus pro integrační úlohy 2, 3, 7, 8 a jejich review, jinak sonnet – cena: jen tokeny.
2. Test follow jen na kanálu, který uživatel nesleduje (nahrazeno 16) – cena: streamer by viděl jedno upozornění.
3. Testovací zpráva jen ve vlastním chatu LordBoos (nahrazeno 16) – cena: jedna zpráva ve vlastním chatu.
4. TV měla uspávání vypnuté přes `-1` místo `0`, úloha 14 vrací 1800000 / 600000 – cena: žádná.
5. Dvě drobnosti z úlohy 1 v úloze 2 (náhled `thumbnail.url`, id jen `/^[\w-]+$/`) – cena: žádná.
6. Převod plných názvů jazyků Kicku na ISO (`English` → `en`) v úloze 8 – cena: chybějící štítek jazyka na kartě.
7. Pojistka follow pro Kick id, `KickApi_RowId` odmítá null/undefined (úloha 4), zápis do `KickApi_LiveCache` při obnově (úloha 6) – cena: žádná.
8. Úloha 15 „UI audit“ na žádost uživatele (Nastavení, překrývající se obrazovky) – cena: čas jedné úlohy.
9. Pro Kick se nuluje příznak partnera (úloha 6) – cena: žádná.
10. Úloha 16 hybridní HW/SW dekódování pro 4-way, uživatel potvrdil – cena: čas jedné úlohy, nové APK, jen větev.
11. PiP: z-order se za běhu neprohazuje, pohledy jsou pevné a přehrávače se mezi nimi přesouvají – cena: krátké problikutí při prohození, pořadí vrstev ověří jen oči uživatele. **Ráno se ukázalo, že to nestačilo:** pořadí na MTK určuje cesta dekodéru (VDP0 dole, VDP1 nahoře), oprava viz ranní kontrola bod 1.
12. AGame bez prázdného tokenu a „Můj kanál“ Kick-only uživatele přes slug (úloha 8) – cena: žádná.
13. Kick dotazy, které drží Twitch seznam, mají timeout 8 s, starý náhled se drží jen u stejného livestreamu, ikonka v Users jen z vlastního `.kick` uživatele – cena: žádná.
14. Oprava regexu kurzoru `/^\d{1,10}$/` v úloze 10 – cena: žádná.
15. `KickBrowse_CatResolve` bere jen id > 0 a pro prázdný slug se neptá – cena: žádná.
16. Přes noc žádný follow/unfollow ani zpráva na Kick účtu uživatele (nahrazuje 2 a 3), ověřeno jen se zachyceným požadavkem – cena: chyba formátu požadavku se najde až ráno.
17. Odpověď 401 u nepotvrzených zapisujících endpointů (follow, chat) jen ukáže varování a nevolá `KickUser_Expired` – cena: vypršení se pozná až při dalším čtení.
18. Pořadí: 15 → 16 → finální review s vlnou oprav → 14 naposled na finálním kódu – cena: žádná.
19. Dávky chyb 4003 softwarového dekodéru do finální vlny, T16 M2 a M3 na ranní seznam – cena: malá změna Javy a jeden 480p běh.
20. Finální vlna oprav I1, M1, M2, M4, M5, T16 M1, T16 M4, M3 zaparkovat – cena: další sada commitů.
21. Původní fixtury se skutečným seznamem sledovaných zůstávají v lokálních commitech `bd196862a` a `12f4b5d0e`, ráno squash-merge nebo souhlas s přepisem historie – cena: při běžném merge se dostanou do veřejného forku.
22. Úloha 14 neutralizuje i `jsonreferences/kick_user_livestreams.json` – cena: jeden commit.

Rozhodnutí úlohy 14:

- Neutrální fixtura má nenulová ukázková id (`1000001`, `2000001`) stejně jako obrázky v `kick_followed.json`, aby testy dál viděly platná id – cena: žádná.
- M3 se opravilo hned, protože akceptace ukázala, že nastává často a jde o malou změnu s testem – cena: jeden commit a nová instalace debug APK.

### Ranní kontrola s uživatelem

1. ~~PiP: malé okno zůstává nahoře po několika prohozeních~~ – **hotovo ráno s uživatelem (commit `da301050e`).** Noční oprava (pevné pohledy) nestačila. Malé okno bylo za velkým po každém druhém prohození, už v původní aplikaci. MTK dává každému dekodéru při vzniku pevnou video cestu (VDP0 hlavní plán dole, VDP1 vedlejší plán nahoře) a prohození přesouvalo dekodéry s přehrávači. Teď se před přesunem oba dekodéry uvolní a vytvoří znovu, nejdřív pro velké okno. Uživatel potvrdil 4–5 prohození v pořádku, v logu 10 prohození bez jediné změny plánu. Cena: obě okna po prohození čekají na další klíčový snímek.
2. Když v PiP skončí hlavní stream, přeživší hraje přes celou obrazovku s obrazem i zvukem.
3. Ukončení multi po rotaci hlavního velkého okna se zachovaným PiP (v noci datově prošlo, obě okna hrála na 2 HW dekodérech – zbývá pohled očima).
4. QR přihlášení telefonem: nový Kick uživatel i připojení k LordBoos.
5. 4-way v 480p na dlouhý večer – sledovat, jestli některý kvadrant bliká nebo se zavře.
6. Skutečný follow → unfollow na Kicku (stav pak jako předtím).
7. Jedna skutečná zpráva „test“ ve vlastním Kick chatu.
8. Vzhled ikonek platforem.
9. Projít zaparkované překryvy UI (výše).
10. Rozhodnutí o merge: squash-merge `feature/kick` (nebo souhlas s přepisem historie), aby se skutečný seznam sledovaných z lokálních commitů `bd196862a` a `12f4b5d0e` nedostal do veřejného forku (Ruling 21).
11. Vydání až po souhlasu: zvýšit `WebTag` i `publishVersionCode` (nové APK je nutné kvůli změnám Javy v úlohách 6 a 16), `ApkUrl`, changelog na obou místech, plná sestava, push. Před pushem doporučuji jednu session na vydaném APK 3.0.395 (web se po merge dostane hned na všechna zařízení).

## Výsledky úloh

| Task | Stav | Poznámka |
| --- | --- | --- |
| 1. Kick API modul, řádky karet, ikonka platformy a fixtury | hotovo | Harness 15 kontrol, ověřeno na TV (Twitch karty beze změny, 0 ikonek) |
| 2. Kick větev playlistu, pojistky proti Twitch volání a ladicí otevření | hotovo | Harness 52 kontrol, ověřeno na TV: Kick živý stream hraje (1080p60 až 160p30, latence 4,68 s, nový token při reconnectu), Twitch beze změny |
| 3. Kick hlavní chat, připojený Twitch a YouTube, propojené chaty pro Kick kanál | hotovo | Harness chat-multi 268 kontrol, ověřeno na TV (xqc): Kick chat s historií, ručně připojený Twitch (anonymní IRC, globální odznaky) a YouTube, dialog „Linked chats“ s řádky Twitch a YouTube, Twitch stream beze změny |
| 4. Stránka Kick kanálu, seznam VOD a klipů | hotovo | Kick 80 kontrol po opravném kole, ověřeno na TV (xqc): logo, banner, sledující, živá karta hraje s Kick chatem, Videa 24 řádků s ikonkou, Klipy 120 řádků po stránkách bez duplicit |
| 5. Přehrávání Kick VOD a klipů | hotovo | Kick 91 kontrol, ověřeno na TV: VOD hraje s hláškou „Chat replay is not available“, pozice 932 s uložená a obnovená, klip (HLS) dohraje do konce |
| 6. 50/50, PiP a čtyři streamy s Kickem, Kick položky v historii | hotovo | Kick 116 kontrol po dvou opravných kolech. Prohození PiP v jednom místě (JS i Java), pevné PiP pohledy s viditelností podle přehrávače. Na TV T+K, K+T, T+T, K+K, 50/50, historie s ikonkou. Pořadí vrstev a přeživší po konci hlavního streamu ověřeny přes SurfaceFlinger, oči uživatele ráno |
| 7. Kick účty – QR přihlášení, samostatný uživatel a připojení k Twitch uživateli | hotovo | Kick 177 kontrol po opravném kole, ověřeno na TV: QR se session URL, Pusher, 403 každé 3 s, Back zavře; připojení k LordBoos tokenem, samostatný Kick uživatel přidán, přepnut, odebrán; Kick-only uživatel posílá na Twitch anonymní hlavičky. Potvrzení telefonem (200) ráno |
| 8. Following Live, panel v přehrávači a boční panel se sloučenými streamy | hotovo | Kick 232 kontrol, Twitch following harness beze změny, ověřeno na TV: sloučené Following podle diváků s ikonkami a `[EN]`, panel i boční panel s Kickem, PiP z panelu; po vypršení žádný Kick dotaz ani ikonka |
| 9. Following Kanály s Kick kanály | hotovo | Kick 260 kontrol, ověřeno na TV: 55 kanálů, z toho 8 Kick (odpovídá curl), abecedně s ikonkou, offline Kick kanál otevře stránku kanálu |
| 10. Procházení Kicku – přepínač platformy, Live, kategorie a streamy v kategorii | hotovo | Kick 324 kontrol po opravném kole, Twitch obrazovky drží zlaté hodnoty, ověřeno na TV: top streamy, kategorie, streamy v IRL hrají, id kategorie dohledané přes `subcategories/<slug>` |
| 11. Vyhledávání na Kicku | hotovo | Kick 392 kontrol po opravném kole, ověřeno na TV: xqc Kanály / Live / Videa, gta Kategorie → streamy, návrat na Twitch |
| 12. Sledování a odsledování Kick kanálu | hotovo | Kick 433 kontrol, na TV se zachyceným požadavkem: stav sledování v přehrávači, na stránce kanálu i v možnostech karty, `POST`/`DELETE …/follow` s Kick tokenem, nic neodesláno (Ruling 16). Skutečný follow → unfollow ráno |
| 13. Psaní do Kick chatu | hotovo | Kick 468 kontrol, na TV se zachyceným požadavkem: „test“ → `POST …/messages/send/<chatroom>` s tělem `{"content":"test","type":"message"}`, nic neodesláno (Ruling 16). Skutečná zpráva ráno |
| 15. UI audit (Nastavení, překrývající se obrazovky) | hotovo | ui-focus 365, navigation 128 po opravném kole. Obě hlášení uživatele zopakována na TV a opravena (spodní položky Nastavení, Following nad Browse s ovládáním obou). Příčina upstream (redesign TV rozhraní, už v master 3.0.395). Tři upstream překryvy zaparkované |
| 16. Hybridní HW/SW dekódování pro 4-way | hotovo | player-ui 104 (106 po finální vlně). 720p neprošlo, 480p plynulé, výchozí 480p. Měření níže |
| Finální review a vlna oprav | hotovo | 0 Critical, 1 Important (Kick id přes `BaseXmlHttpGetFull` do Helixu), 5 Minor. Opraveno I1, M1, M2, M4, M5, T16 M1 (softwarový slot vydrží 7 chyb 4003 za sebou), T16 M4. Kick 479, player-ui 106, opakovaný 480p běh 12,3 min níže |
| 14. Akceptace na TV, debug APK a předání | hotovo | Kick 483 kontrol. Akceptace 26 prošlo (1 po opravě), 0 neprošlo, 3 zaparkováno. Neutralizovaná fixtura (`6cf3d0373`), oprava historie (`2c5ebc636`), debug APK z `2c5ebc636` na TV, TV vrácená |

## Akceptace na TV (úloha 14)

Finální kód, debug APK z `2c5ebc636` (historie ověřená po přeinstalaci, zbytek na APK z `eb739d1a5`, které se od finálního liší jen touto opravou). Před akceptací: `node release/scripts/maker.js jsh` a všech 14 harnessů zelených, plná sestava `node release/scripts/maker.js` bez chyb (vygenerované soubory vrácené). Kanály v testu jsou sledovaný Kick kanál uživatele a veřejné top kanály.

| Bod | Stav | Ověření |
| --- | --- | --- |
| Základ: Kick live z Following | prošlo | Kick karta ve Following → přehrávač hraje, řádek `[19]='kick'`, Kick chat bez Twitch IRC a bez raid EventSub |
| Základ: kvality | prošlo | Auto, 1080p30 source, 720p30, 480p30, 360p30, 160p30 (u n3on 1080p60 až 160p30) |
| Základ: nízká latence | prošlo | Nízká latence zapnutá, živý posun 6,2 s hned po startu (úloha 2 naměřila 4,68 s) |
| Základ: reconnect | prošlo | `Play_loadData()` → nový token v master URL, přehrávání pokračuje |
| Základ: Twitch beze změny | prošlo | Twitch karta hraje (1080p60 source…), Twitch IRC otevřený, raid aktivní, číselná id; bez platného Kick tokenu Following jen Twitch bez ikonek; všechny harnessy zelené |
| A: Kick VOD s posunem a pokračováním | prošlo | xqc VOD: posun na 1200 s → 1205 s, po odchodu uloženo 1218 s, znovu otevřené pokračuje od uložené pozice |
| A: klip | prošlo | xqc klip „Auto \| hls“, čas běží 6,2 → 10,2 s |
| A: stránka kanálu | prošlo | Z vyhledávání: logo, 1 466 080 sledujících, popis, banner, offline karta, Videa 25, Klipy 20 |
| A: Kick chat s historií | prošlo | 25 řádků historie hned po startu, pak živé zprávy (Pusher otevřený) |
| A: připojený Twitch a YouTube | prošlo | Ruční propojení: Kick, Twitch (anonymní IRC) a YouTube řádky s ikonkami platforem; propojení pak vráceno |
| A: Linked chats | prošlo | Dialog s řádky Twitch, YouTube, „Link this streamer: Yes“, Back zavře |
| A: VOD bez chatu | prošlo | „Chat replay is not available for Kick videos“ |
| A: 50/50 | prošlo | Twitch + Kick, každá strana svůj chat, po prohození chaty následují streamy |
| A: PiP Twitch/Kick, Kick/Twitch, Kick/Kick | prošlo | PiP z panelu klávesou 1, 4 prohození T+K / K+T a 1 prohození K/K: data, chat a Kick session vždy patří hlavnímu streamu, SurfaceFlinger má stále stejné dvě vrstvy. Pořadí vrstev ráno očima |
| A: čtyři streamy | prošlo | 2× Kick + 2× Twitch, 2× `OMX.MTK.VIDEO.DECODER.AVC` + 2× `c2.android.avc.decoder`, ~6 min bez chyby dekodéru; rotace hlavního velkého okna s chatem; ukončení multi zachová PiP na 2 HW dekodérech. Slot n3on se po 5,5 min zavřel jako konec streamu (ExoPlayer ENDED), kanál byl brzy nato offline; slot pak doplněn z panelu |
| A: historie s Kick položkami | prošlo po opravě | Nejdřív neprošlo: stream vanOtica z Kick kategorie se do historie nezapsal (`v2/channels` bez náhledu → prázdné `[0]` → `Main_Set_history` ho vynechal). Opraveno v `2c5ebc636` s testem, po přeinstalaci Absi (taky bez náhledu) v Knihovně → Live s ikonkou K |
| B: Kick uživatel (token) | prošlo | LordBoos s připojeným Kickem po přeinstalaci, dialog uživatele, QR dialog pro opětovné přihlášení. Samostatný Kick uživatel ověřen v úloze 7 |
| B: Following Live | prošlo | Twitch a Kick karty sloučené podle diváků s ikonkami a `[EN]` |
| B: Following Kanály | prošlo | 8 Kick kanálů mezi 36 načtenými, ikonka K |
| B: panel v přehrávači | prošlo | Panel Following v přehrávači má Twitch i Kick položku, z Kick položky PiP i doplnění 4-way |
| B: boční panel | prošlo | Twitch i Kick položka, náhled Kick streamu hraje |
| B: „sign in again“ po simulaci vypršení | prošlo | `KickUser_Expired()` → varování „Kick sign in expired, sign in again in Users“, Following jen Twitch bez ikonek, v dialogu uživatele „Sign in to Kick again“ → QR dialog, Back zavře. Příznak pak vrácen, Following znovu sloučené |
| B: záloha na Google Drive | zaparkováno | Bez Google účtu na TV nejde ověřit, kód zálohy kontroloval review (Kick údaje v záloze, odebraní uživatelé bez Kick session) |
| C: přepínač platformy | prošlo | Browse → Live: přepínač Twitch → Kick a zpět, Twitch seznam pak beze změny |
| C: Live | prošlo | 30 Kick streamů z `mobile.kick.com`, n3on hraje |
| C: kategorie | prošlo | 24 Kick kategorií po stránkách, GTA → 30 streamů, vanOtica hraje |
| C: vyhledávání | prošlo | „xqc“ → 20 Kick kanálů s ikonkou z `search.kick.com` → stránka kanálu (Live a Kategorie vyhledávání ověřila úloha 11) |
| D: follow/unfollow | zaparkováno | Ruling 16: přes noc nic na účtu uživatele. Úloha 12 ověřila na TV se zachyceným požadavkem stav i `POST`/`DELETE` s Kick tokenem. Skutečný round trip ráno |
| D: psaní do chatu | zaparkováno | Ruling 16. Úloha 13 ověřila na TV se zachyceným požadavkem přesné tělo zprávy. Skutečná zpráva „test“ ráno |

## Úloha 16 – měření 4-way na TV

TV Sony BRAVIA (MTK, 4× Cortex-A73 1,8 GHz), HW dekodér zvládne jen 2 videa naráz. Sloty 0–1 HW, sloty 2–3 softwarový `c2.android.avc.decoder`, 4-way s velkým hlavním oknem a chatem.

| Limit SW slotů | CPU (z 400 %) | Zahozené snímky SW slotů | Odezva ovladače (medián / max) | Verdikt |
| --- | --- | --- | --- | --- |
| 720p (150 s) | 386–394 % | 86,9 % a 86,7 % (7–8 fps), i HW hlavní 8,2 % | 86 ms / 1873 ms | neplynulé |
| 480p (170 s) | 263–351 % | 0,9 % a 0,8 % (28,5 fps) | 51 ms / 113 ms | plynulé, výchozí |

Opakovaný běh 480p po finální vlně oprav (12,3 min, sloty Twitch HW, Kick HW, Twitch SW, Kick SW):

| Slot | Dekodér | Chyby 4003 | Největší dávka | Zavřené sloty | Zahozené snímky |
| --- | --- | --- | --- | --- | --- |
| 0 Twitch | HW | 0 | 0 | 0 | 0,01 % |
| 1 Kick | HW | 0 | 0 | 0 | 0,04 % |
| 2 Twitch | SW | 0 | 0 | 0 | 1,42 % |
| 3 Kick | SW | 11 | 3 | 0 | 1,83 % |

Každá chyba 4003 znamená asi 1 s obnovy slotu. Softwarový slot teď vydrží 7 chyb za sebou, osmá ho zavře (rozsah 4–7 ověřen jen uměle vyvolanými chybami). Dlouhý večerní běh je na ranním seznamu.
