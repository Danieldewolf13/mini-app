# mini app

Eerste aparte mini-app naast de bestaande Telegram bot.

Doel van deze eerste versie:
- aparte dispatcher webinterface
- jobs uit dezelfde MySQL lezen
- overzicht met filters en kaartplaceholder
- klaarzetten voor latere uitbreiding met:
  - techniekerinterface
  - Billit snelkoppelingen
  - planning
  - live dispatch acties

## Starten

Gebruik een eigen mini-app databaseconfiguratie:

```powershell
$env:MINI_APP_DB_HOST="ID224774_miniapp.db.webhosting.be"
$env:MINI_APP_DB_USER="ID224774_miniapp"
$env:MINI_APP_DB_PASS="..."
$env:MINI_APP_DB_NAME="ID224774_miniapp"
$env:BILLIT_BASE_URL="https://app.billit.eu"
uvicorn app.main:app --reload
```

Open daarna:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/dispatcher`

## Node.js variant voor Combell

Er staat nu ook een eerste Node.js versie naast de FastAPI-app in [node-app/package.json](C:/Users/freek/Documents/mini-app/node-app/package.json) en [node-app/src/server.js](C:/Users/freek/Documents/mini-app/node-app/src/server.js).

Die gebruikt:

- dezelfde `MINI_APP_DB_*` env vars
- dezelfde SQL-tabellen
- dezelfde CSS en front-end JS uit `app/static`
- dezelfde routes:
  - `/`
  - `/dispatcher`
  - `/api/dashboard`
  - `/health`

### Node lokaal starten

```powershell
cd .\node-app
npm install

$env:MINI_APP_DB_HOST="ID224774_miniapp.db.webhosting.be"
$env:MINI_APP_DB_USER="ID224774_miniapp"
$env:MINI_APP_DB_PASS="..."
$env:MINI_APP_DB_NAME="ID224774_miniapp"
$env:BILLIT_BASE_URL="https://app.billit.eu"
$env:PORT="3000"

npm run dev
```

Open daarna:

- `http://127.0.0.1:3000/`
- `http://127.0.0.1:3000/dispatcher`

Deze Node-variant is bedoeld als startpunt voor Combell-hosting, zodat we de huidige UI en datalogica kunnen meenemen zonder alles opnieuw te ontwerpen.

### Combell deploymentflow

Ik heb ook een root [package.json](C:/Users/freek/Documents/mini-app/package.json) toegevoegd zodat de Combell pipeline direct de vereiste scripts ziet.

Volgens de officiële Combell Node.js handleiding, laatst geüpdatet op **11 december 2024**, moet je repository minstens een `build` en `serve` script bevatten. Bron: [Aan de slag met Node.js](https://www.combell.com/nl/help/kb/aan-de-slag-met-node-js/)

Voor deze repo betekent dat:

- root `build`: installeert de dependencies in `node-app`
- root `serve`: start de Express-app uit `node-app/src/server.js`

Praktisch in Combell:

1. Zet deze volledige repo in GitHub of GitLab.
2. Koop of activeer een Node.js pakket in Combell.
3. Ga naar `Mijn Producten > Webhosting > Beheer hosting > Node.js`.
4. Klik op `Instance toevoegen`.
5. Kies:
   - een Node.js versie die Combell aanbiedt
   - poort: de poort die je in de instance instelt moet overeenkomen met wat Combell verwacht voor die instance
   - git repository: deze repo
6. Voeg de deploy key van Combell toe aan GitHub/GitLab.
7. Run daarna de pipeline.
8. Koppel de websitebackend aan die Node.js instance via `Websites & SSL > Beheer website > Website backend wijzigen`.

Belangrijk:

- de app leest haar poort via `PORT`, dus Combell kan die waarde injecteren
- de DB-config blijft via `MINI_APP_DB_HOST`, `MINI_APP_DB_USER`, `MINI_APP_DB_PASS`, `MINI_APP_DB_NAME`
- als Combell geen losse env vars per instance aanbiedt, moeten we die waarden nog via hun Node.js instance-instellingen of een veilige config-oplossing invullen

## Database opzetten

De app verwacht deze tabellen:

- `clients`
- `users`
- `cards`
- `payments`
- `afspraak`

Ik heb daarvoor nu twee SQL-bestanden toegevoegd:

- [001_mini_app_schema.sql](C:/Users/freek/Documents/mini-app/sql/001_mini_app_schema.sql)
- [002_mini_app_seed.sql](C:/Users/freek/Documents/mini-app/sql/002_mini_app_seed.sql)

### Optie 1: via phpMyAdmin

1. Open je database `ID224774_miniapp`
2. Importeer eerst `sql/001_mini_app_schema.sql`
3. Importeer daarna `sql/002_mini_app_seed.sql`

### Optie 2: via mysql command line

```powershell
Get-Content -Raw .\sql\001_mini_app_schema.sql | mysql -h ID224774_miniapp.db.webhosting.be -u ID224774_miniapp -p ID224774_miniapp
Get-Content -Raw .\sql\002_mini_app_seed.sql | mysql -h ID224774_miniapp.db.webhosting.be -u ID224774_miniapp -p ID224774_miniapp
```

Na import bevat de mini-app meteen:

- voorbeeldklanten
- techniekers
- actieve jobs
- betalingen
- afspraken voor vandaag en morgen

Daarmee kan het dashboard direct renderen zonder lege staat.

## Deployen naar Google Cloud Run

Deze codebasis is nu ook klaar voor Cloud Run via [Dockerfile](C:/Users/freek/Documents/mini-app/Dockerfile) en [cloudbuild.yaml](C:/Users/freek/Documents/mini-app/cloudbuild.yaml).

### 1. Benodigde env vars in Cloud Run

Zet in Google Cloud Run deze environment variables:

- `MINI_APP_DB_HOST`
- `MINI_APP_DB_USER`
- `MINI_APP_DB_PASS`
- `MINI_APP_DB_NAME`
- `BILLIT_BASE_URL`

### 2. Rechtstreeks deployen met gcloud

```powershell
gcloud run deploy mini-app `
  --source . `
  --region europe-west1 `
  --allow-unauthenticated `
  --set-env-vars BILLIT_BASE_URL=https://app.billit.eu `
  --set-env-vars MINI_APP_DB_HOST=ID224774_miniapp.db.webhosting.be `
  --set-env-vars MINI_APP_DB_USER=ID224774_miniapp `
  --set-env-vars MINI_APP_DB_NAME=ID224774_miniapp `
  --set-env-vars MINI_APP_DB_PASS=YOUR_PASSWORD
```

### 3. Deployen via Cloud Build

Maak eerst in Artifact Registry een Docker repository met de naam `mini-app` in regio `europe-west1`. Daarna:

```powershell
gcloud builds submit --config cloudbuild.yaml
```

### 4. Health check

Na deploy:

- `/health` geeft een eenvoudige status terug
- `/` en `/dispatcher` proberen wel meteen DB-data op te halen

Als de homepage niet opent maar `/health` wel werkt, dan is meestal de databaseconfig of het schema nog niet volledig klaar.

## Wat deze versie al doet

- actieve jobs lezen uit `cards`, `clients`, `users`
- laatste betaalmetadata uit `payments` lezen
- afspraken van vandaag/tomorrow tonen
- bestaande botmappings hergebruiken:
  - gewone groepen
  - corp-groepen
  - statuslabels
  - betaalstatuslabels
  - betaalmethodes
- dispatcher dashboard met:
  - statuskaarten
  - joblijst
  - filter op status/categorie/zoekterm
  - eenvoudige kaartlaag
  - snelle `Open Billit` knop

Dus:
- aparte codebasis
- met eigen databaseconfiguratie
- zodat deze app los van de bot kan evolueren

## Wat nog niet in deze eerste versie zit

- login / rechten
- echte schrijfacties naar jobs
- Telegram Mini App authenticatie
- Billit API sync
- productieklare geocoding cache

Deze eerste versie is bewust een aparte basis, zodat de bestaande botflow niet geraakt wordt.
