# Delivery Map Scanner

A phone app (PWA) for scanning UPS shipping labels and seeing every delivery as a coloured pin on Google Maps. Built for ~80 scans a day: point the camera at the label, it reads the **SHIP TO** address, puts it on the map, and is ready for the next package.

Everything is stored on the phone (IndexedDB). There is no server and no account.

## Quick start (no coding)

1. **Get a Google Maps key** (Google’s monthly free usage normally covers 80 scans a day)
   - Go to <https://console.cloud.google.com/>, create a project, and enable billing.
   - Under *APIs & Services → Library*, enable **Maps JavaScript API** and **Geocoding API**.
   - Under *APIs & Services → Credentials*, create an **API key**. Restrict it to *Websites* and add the address you deploy to (e.g. `https://your-site.netlify.app/*`).
2. **Put the app online.** The camera only works over HTTPS.
   - Easiest: open <https://app.netlify.com/drop> and drag the included `dist` folder onto the page. You get an `https://….netlify.app` address.
3. **On your phone**, open that address in Chrome (Android) or Safari (iPhone).
   - Go to **Settings → Google Maps**, paste the key, tap *Save map settings*.
   - Use *Add to Home Screen* (or the *Install* button in Settings) so it opens full screen.
4. Tap **Scan Label** and allow camera and location access.

The first scan downloads the text-recognition engine (about 9 MB). After that, scanning works offline. Deliveries scanned offline are placed on the map automatically when you are back online.

## Daily workflow

- **Scan Label** opens the rear camera. Fit the SHIP TO block in the frame. With **Auto** on, the label is read as soon as the camera is steady; otherwise tap the round button. You can also upload a photo (the picture icon). Sideways photos are rotated automatically.
- A clear scan is saved immediately with your default colour and description. A short beep/vibration confirms it, and a banner shows the address with **Undo**, quick colour buttons and description buttons.
- If anything is doubtful (no SHIP TO found, blurry text, address not found or only approximately found on the map, tracking number already scanned), the app **stops and asks you to check** the address. You can edit fields, check the address again, drag the pin, or save without a pin.
- After saving, keep the next label in view. The same label is not read twice; a scanned tracking number is flagged as a duplicate.
- **Map**: tap a pin for address, tracking number, colour, description and status, plus **Navigate**, **Mark delivered**, **Edit** and **Delete**. Packages at the same address share one pin with a number badge. Buttons on the right: hide delivered, show all pins, centre on me.
- **List**: search by street, postcode, description or tracking number, filter by colour or status, and sort by scan order, address or status. Tap an entry to jump to its pin. Use ✓ to mark it delivered in one tap. **Not on map** shows anything that still needs a position.
- **Settings**: default colour, default description, description templates (add, rename, reorder, delete), auto-save, auto-capture, map options, CSV export, and clearing delivered or all deliveries (with confirmation).

## How the address is found

1. The camera frame is cropped, enlarged, converted to grayscale, contrast-stretched and sharpened.
2. Tesseract OCR (Danish + English models, so Æ Ø Å work) reads the text. If the address is incomplete, the app re-reads just the area under **SHIP TO** as a single block, then tries a sparse-text mode.
3. The parser only uses lines after the SHIP TO heading, which keeps the sender address in the top-left corner out of it. It recognises Danish formats such as `Nørrebrogade 12, 2. th`, `Østerbrogade 45A / st. tv`, `Gl. Kongevej 10, 3. 4`, `DK-2100 København Ø` and common OCR slips (`0`/`O`, `1`/`I`, `]`/`J`).
4. A UPS `1Z…` tracking number is read from the printed text if visible and validated with its check digit. The barcode is never used for the address.
5. Google geocoding must return an exact street address whose postcode and house number match. Otherwise the driver is asked to confirm.

## Developer setup

```bash
npm install
npm run dev        # http://localhost:5173 (camera works on localhost)
npm test           # parser unit tests
npm run build      # production build in dist/
```

- Optional `.env`: `VITE_GOOGLE_MAPS_API_KEY=…` and `VITE_GOOGLE_MAP_ID=…`. The key can also be entered in Settings.
- `predev`/`prebuild` copy the Tesseract worker, WASM cores and `dan`/`eng` language data into `public/tesseract/`, so OCR is served from the app itself and cached by the service worker.
- `DEMO_MAP_ID` is used as the map ID by default. Advanced markers need a map ID; create your own under *Google Cloud → Map Management* if you want custom styling.
- The build assumes it is served from the site root (`/`).

### Code map

| Path | What it does |
| --- | --- |
| `src/lib/labelParser.ts` | SHIP TO detection, Danish address parsing, tracking number + check digit, confidence score |
| `src/lib/multipass.ts` | OCR retry strategy (whole label → SHIP TO block → sparse) |
| `src/lib/ocr.ts` | Tesseract worker, image preprocessing |
| `src/lib/frame.ts` | Sharpness and motion measurement for auto-capture |
| `src/lib/maps.ts` | Google Maps loader, geocoding with quality checks, navigation links |
| `src/lib/db.ts`, `store.ts` | IndexedDB (Dexie): deliveries, templates, settings, offline geocode retry |
| `src/components/Scanner.tsx` | Camera, auto-capture loop, auto-save vs. review decision |
| `src/components/MapView.tsx` | Map, coloured pins, clustering, GPS dot |
| `src/components/ListView.tsx`, `InfoSheet.tsx`, `EditSheet.tsx`, `SettingsView.tsx` | The other screens |

## Known limits

- OCR accuracy depends on light and focus. Use the flashlight button in dark vans, and hold the phone 15–25 cm from the label.
- Handwritten labels are not supported.
- Autofocus control and the flashlight depend on the phone/browser (mostly Android Chrome). On iPhone the camera focuses on its own and the flashlight button is hidden.
- If you change the API key while the map is open, reload the app.
