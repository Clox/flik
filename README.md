# Flik

Flik visar hur länge sedan du faktiskt använde en flik genom en liten färgmarkering på dess favicon. Tiden mäts som aktivitet i Chrome, så timmar i andra program åldrar inte flikarna. All data stannar lokalt i Chrome.

## Installera lokalt

1. Öppna `chrome://extensions` i Google Chrome.
2. Slå på **Developer mode / Utvecklarläge**.
3. Välj **Load unpacked / Läs in opaketerat tillägg** och välj den här projektmappen.
4. Öppna Fliks inställningar via tilläggets verktygsfältsikon. Flik startar också i vanliga webbsidor som redan är öppna.

Om du uppdaterar en tidigare installerad version, tryck **Reload / Läs in igen** på Fliks kort i `chrome://extensions`. Version 0.1.1 rättar felet där bara nyligen laddade flikar fick markering.

Ingen byggning, server eller npm-installation behövs. Kör `npm test` för enhetstester. `test/browser-smoke.mjs` testar favicon-koden i en lokal Chrome-sida via DevTools-protokollet och kräver en separat Chrome-instans med `--remote-debugging-port=9228`.

## Så fungerar det

- `content.js` körs i vanliga HTTP(S)-sidor, även i redan öppna flikar efter installation eller uppdatering. Det observerar sidans favicon-länkar, prövar också Chromes kända favicon-URL och `/favicon.ico` som reserv, ritar originalikonen i sin naturliga favicon-storlek och lägger färgmarkeringen ovanpå. Flik lägger till en egen länk sist i `<head>`; sidans egna länkar ändras inte. När markeringen stängs av tas Fliks länk bort.
- Betrodda klick, tangenttryck, beröringar och hjulhändelser från en synlig sida registrerar användning direkt. En synlig flik räknas också efter vald tröskel, 10 sekunder som standard. Snabba flikpassager räknas inte.
- `background.js` håller en gemensam aktivitetsklocka. Den går när Chrome har fokus och `chrome.idle` säger att användaren är aktiv. En alarmhändelse var 30:e sekund uppdaterar tillståndet. Klockan sparas i `chrome.storage.local` och långa luckor, till exempel viloläge eller avstängd service worker, räknas inte retroaktivt.
- Inställningar, klocka och flikarnas senaste användning sparas lokalt. Vid omstart matchas återställda flikar mot tidigare flikar efter exakt URL. Enskilda flikundantag lagras i sessionslagring, väljs via högerklicksmenyn och gäller tills fliken stängs eller Chrome avslutas.

## Begränsningar

Chrome ger inte tillägg möjlighet att rita direkt i flikraden. Därför fungerar markeringen bara där ett content script kan köras. `chrome://`-sidor, Chrome Web Store, andra tilläggssidor och andra skyddade sidor får ingen markering. Filsidor kräver separat filåtkomst och ingår inte i första versionen.

Faviconer från andra domäner måste tillåta CORS för att Canvas ska kunna läsa bilden. Om en ikon inte kan läsas lämnas webbplatsens originalikon orörd. Sidor som använder ovanlig favicon-hantering, till exempel en länk med mediefrågor eller flera ikoner för olika storlekar, kan behöva särskild hantering. Ikoner över 128 pixlar begränsas för att hålla resurserna nere.

Chromes `idle`-API rapporterar inaktivitet i steg och kan inte skilja på alla typer av automatisk aktivitet. Flik använder bara DOM-händelser med `isTrusted` för direkt interaktion; en sidgenererad scrollhändelse räknas inte. Klockan använder ett försiktigt tak på 35 sekunder per uppdatering för att undvika att viloläge och plötsliga omstarter åldrar flikarna. Det kan förlora upp till en kort aktivitetsperiod efter en oväntad avstängning.

Historiknavigering ingår inte i denna version. Arkitekturen håller redan `lastUsed` per flik, men en faktisk bakåt/framåt-stack och tangentkommandon behöver utformas separat. Chromes `commands`-API begränsar tillåtna tangentkombinationer.

Automatiskt fullständigt tilläggstest är inte verifierat i den installerade Chrome-versionen. Officiell Google Chrome tog bort kommandoradsflaggan `--load-extension` i version 137. Browser-smoketestet kör därför content scriptet med en API-stub i Chrome och testar Canvas-markering, dynamisk favicon och återställning. Tilläggets samspel med Chromes API:er bör kontrolleras manuellt efter **Load unpacked**.

## Behörigheter

`tabs` läser flikarnas URL och skickar färg till rätt flik; `scripting` startar Flik i redan öppna flikar; `storage` sparar data; `idle` upptäcker AFK och låst dator; `alarms` väcker service workern; `contextMenus` ger undantag per flik. HTTP(S)-åtkomst behövs för content scriptet på vanliga webbplatser. Tillägget har ingen telemetri eller egen server.
