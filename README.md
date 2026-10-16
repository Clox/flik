# Flik

Flik visar hur länge sedan du faktiskt använde en flik genom en liten färgmarkering på dess favicon. Tiden mäts som aktivitet i Chrome, så timmar i andra program åldrar inte flikarna. All data stannar lokalt i Chrome.

## Installera lokalt

1. Öppna `chrome://extensions` i Google Chrome.
2. Slå på **Developer mode / Utvecklarläge**.
3. Välj **Load unpacked / Läs in opaketerat tillägg** och välj den här projektmappen.
4. Öppna Fliks inställningar via tilläggets verktygsfältsikon. Flik startar också i vanliga webbsidor som redan är öppna.

Om du uppdaterar en tidigare installerad version, tryck **Reload / Läs in igen** på Fliks kort i `chrome://extensions`. Version 0.1.5 tar bort kvarvarande markörlänkar från äldre Flik-skript helt, så att Chrome kan välja den nya faviconen. Flikdiagnosen längst ned på inställningssidan visar antalet aktiva och äldre markörer per flik.

Om några flikar saknar markering: öppna inställningarna, tryck **Kontrollera flikar**, och se status per flik. **Kopiera resultat** ger en rapport som du kan dela vid felsökning. Rapporten innehåller domän och sökväg, men utelämnar frågesträng och fragment; granska den före delning. En vilande flik får markering när Chrome laddar den.

Ingen byggning, server eller npm-installation behövs. Kör `npm test` för enhetstester. `npm run test:chrome` kör ett fullständigt tilläggstest i en tillfällig Chrome-profil med tjugo flikar, varav tolv öppnas före tillägget installeras. Testet kräver lokal Chrome och möjlighet att starta den med DevTools pipe. `test/browser-smoke.mjs` testar också innehållsskriptet separat via DevTools-port 9228.

## Så fungerar det

- `content.js` körs i vanliga HTTP(S)-sidor, även i redan öppna flikar efter installation eller uppdatering. Det observerar sidans favicon-länkar, prövar Chromes kända favicon-URL och `/favicon.ico`, och använder vid behov [Chromes favicon-API](https://developer.chrome.com/docs/extensions/how-to/ui/favicons) för ikoner från andra domäner. Det ritar färgmarkeringen ovanpå originalet och tar bort egna äldre ikonlänkar så att markeringar inte staplas. Sidans egna länkar ändras inte.
- Betrodda klick, tangenttryck, beröringar och hjulhändelser från en synlig sida registrerar användning direkt. En synlig flik räknas också efter vald tröskel, 10 sekunder som standard. Snabba flikpassager räknas inte.
- `background.js` håller en gemensam aktivitetsklocka. Den går när Chrome har fokus och `chrome.idle` säger att användaren är aktiv. En alarmhändelse var 30:e sekund uppdaterar tillståndet. Klockan sparas i `chrome.storage.local` och långa luckor, till exempel viloläge eller avstängd service worker, räknas inte retroaktivt.
- Inställningar, klocka och flikarnas senaste användning sparas lokalt. Vid omstart matchas återställda flikar mot tidigare flikar efter exakt URL. Enskilda flikundantag lagras i sessionslagring, väljs via högerklicksmenyn och gäller tills fliken stängs eller Chrome avslutas.

## Begränsningar

Chrome ger inte tillägg möjlighet att rita direkt i flikraden. Därför fungerar markeringen bara där ett content script kan köras. `chrome://`-sidor, Chrome Web Store, andra tilläggssidor och andra skyddade sidor får ingen markering. Filsidor kräver separat filåtkomst och ingår inte i första versionen.

Om varken sidans ikon eller Chromes favicon-cache har en läsbar bild lämnas originalfaviconen orörd. Sidor som använder ovanlig favicon-hantering, till exempel en länk med mediefrågor eller flera ikoner för olika storlekar, kan behöva särskild hantering. Ikoner över 128 pixlar begränsas för att hålla resurserna nere.

Chromes `idle`-API rapporterar inaktivitet i steg och kan inte skilja på alla typer av automatisk aktivitet. Flik använder bara DOM-händelser med `isTrusted` för direkt interaktion; en sidgenererad scrollhändelse räknas inte. Klockan använder ett försiktigt tak på 35 sekunder per uppdatering för att undvika att viloläge och plötsliga omstarter åldrar flikarna. Det kan förlora upp till en kort aktivitetsperiod efter en oväntad avstängning.

Historiknavigering ingår inte i denna version. Arkitekturen håller redan `lastUsed` per flik, men en faktisk bakåt/framåt-stack och tangentkommandon behöver utformas separat. Chromes `commands`-API begränsar tillåtna tangentkombinationer.

Det fullständiga tilläggstestet använder `Extensions.loadUnpacked` via DevTools pipe i en tillfällig profil, eftersom officiell Google Chrome tog bort kommandoradsflaggan `--load-extension` i version 137. Testet verifierar flera flikar, externa faviconer, positionsbyte utan dubbla staplar och återställning vid undantag.

## Behörigheter

`tabs` läser flikarnas URL och skickar färg till rätt flik; `scripting` startar Flik i redan öppna flikar; `favicon` läser Chromes lokala favicon-cache; `storage` sparar data; `idle` upptäcker AFK och låst dator; `alarms` väcker service workern; `contextMenus` ger undantag per flik. HTTP(S)-åtkomst behövs för content scriptet på vanliga webbplatser. Tillägget har ingen telemetri eller egen server.
