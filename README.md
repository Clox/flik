# Flik

Flik visar hur länge sedan du faktiskt använde en flik genom en liten färgmarkering på dess favicon. Tiden mäts som aktivitet i Chrome, så timmar i andra program åldrar inte flikarna. All data stannar lokalt i Chrome.

## Installera lokalt

1. Öppna `chrome://extensions` i Google Chrome.
2. Slå på **Developer mode / Utvecklarläge**.
3. Välj **Load unpacked / Läs in opaketerat tillägg** och välj den här projektmappen.
4. Öppna Fliks inställningar via tilläggets verktygsfältsikon. Flik startar också i vanliga webbsidor som redan är öppna.

Om du uppdaterar en tidigare installerad version, tryck **Reload / Läs in igen** på Fliks kort i `chrome://extensions`. Version 0.1.7 skiljer sin markör från äldre Flik-versioners markörer och väljer en enda aktiv skriptinstans per sida. Den rättar en regression i 0.1.6 där flera gamla skript kunde ta bort varandras indikatorer. Flikdiagnosen frågar bara den nya instansen.

Om några flikar saknar markering: öppna inställningarna, tryck **Kontrollera flikar**, och se status per flik. **Kopiera resultat** ger en rapport som du kan dela vid felsökning. Rapporten innehåller domän och sökväg, men utelämnar frågesträng och fragment; granska den före delning. En vilande flik får markering när Chrome laddar den.

Ingen byggning, server eller npm-installation behövs. Kör `npm test` för enhetstester. `npm run test:chrome` kör ett fullständigt tilläggstest i en tillfällig Chrome-profil med tjugo flikar, varav tolv öppnas före tillägget installeras. Testet kräver lokal Chrome och möjlighet att starta den med DevTools pipe. `test/browser-smoke.mjs` testar också innehållsskriptet separat via DevTools-port 9228.

## Så fungerar det

- `content.js` körs i vanliga HTTP(S)-sidor, även i redan öppna flikar efter installation eller uppdatering. Det observerar sidans favicon-länkar, prövar Chromes kända favicon-URL och `/favicon.ico`, och använder vid behov [Chromes favicon-API](https://developer.chrome.com/docs/extensions/how-to/ui/favicons) för ikoner från andra domäner. Det ritar färgmarkeringen ovanpå originalet och tar bort egna äldre ikonlänkar så att markeringar inte staplas. Sidans egna länkar ändras inte.
- Betrodda klick, tangenttryck, beröringar och hjulhändelser från en synlig sida registrerar användning direkt. En synlig flik räknas också efter vald tröskel, 10 sekunder som standard. Snabba flikpassager räknas inte.
- `background.js` håller en gemensam aktivitetsklocka. Den går när Chrome har fokus och `chrome.idle` säger att användaren är aktiv. En alarmhändelse var 30:e sekund uppdaterar tillståndet. Klockan sparas i `chrome.storage.local` och långa luckor, till exempel viloläge eller avstängd service worker, räknas inte retroaktivt.
- Inställningar, klocka och flikarnas senaste användning sparas lokalt. Vid omstart matchas återställda flikar mot tidigare flikar efter exakt URL. Enskilda flikundantag lagras i sessionslagring, väljs via högerklicksmenyn och gäller tills fliken stängs eller Chrome avslutas.

## Begränsningar

Chrome ger inte tillägg möjlighet att rita direkt i flikraden. Därför fungerar markeringen bara där ett content script kan köras. `chrome://`-sidor, Chrome Web Store, andra tilläggssidor och andra skyddade sidor får ingen markering. Filsidor kräver separat filåtkomst och ingår inte i första versionen.

Om varken sidans ikon eller Chromes favicon-cache har en läsbar bild lämnas originalfaviconen orörd. Sidor som använder ovanlig favicon-hantering, till exempel en länk med mediefrågor eller flera ikoner för olika storlekar, kan behöva särskild hantering. Flik återger originalikonen i flikradens 16 × 16 pixlar och ritar markeringen ovanpå utan att krympa ikonen för att göra plats.

Chrome kan behålla en tidigare vald favicon på redan öppna flikar även när Fliks nya ikonlänk finns i sidan. En omladdning av just fliken kan då få Chrome att välja om ikonen. Sidans Content Security Policy kan också blockera data-URL:er för faviconer; Fliks diagnos visar när en sådan blockering upptäcks. Chrome ger inte Manifest V3-tillägg ett direkt API för att sätta bilden i den inbyggda flikraden.

Chromes `idle`-API rapporterar inaktivitet i steg och kan inte skilja på alla typer av automatisk aktivitet. Flik använder bara DOM-händelser med `isTrusted` för direkt interaktion; en sidgenererad scrollhändelse räknas inte. Klockan använder ett försiktigt tak på 35 sekunder per uppdatering för att undvika att viloläge och plötsliga omstarter åldrar flikarna. Det kan förlora upp till en kort aktivitetsperiod efter en oväntad avstängning.

Historiknavigering ingår inte i denna version. Arkitekturen håller redan `lastUsed` per flik, men en faktisk bakåt/framåt-stack och tangentkommandon behöver utformas separat. Chromes `commands`-API begränsar tillåtna tangentkombinationer.

Det fullständiga tilläggstestet använder `Extensions.loadUnpacked` via DevTools pipe i en tillfällig profil, eftersom officiell Google Chrome tog bort kommandoradsflaggan `--load-extension` i version 137. Testet verifierar flera flikar, externa faviconer, positionsbyte utan dubbla staplar och återställning vid undantag.

## Behörigheter

`tabs` läser flikarnas URL och skickar färg till rätt flik; `scripting` startar Flik i redan öppna flikar; `favicon` läser Chromes lokala favicon-cache; `storage` sparar data; `idle` upptäcker AFK och låst dator; `alarms` väcker service workern; `contextMenus` ger undantag per flik. HTTP(S)-åtkomst behövs för content scriptet på vanliga webbplatser. Tillägget har ingen telemetri eller egen server.
