# FARA stranica

Web stranica i rezervacije za FARA d.o.o. Travnik / Fara Sport Centar.

## Desktop admin aplikacija

Electron desktop aplikacija je u folderu `electron/`.

Pokretanje:

```bash
pnpm desktop
```

Pravljenje Mac aplikacije:

```bash
pnpm desktop:build
```

Gotovi fajlovi izlaze u `dist/`:

- `FARA Admin-1.0.0-universal.dmg` za instalaciju na Mac
- `mac-universal/FARA Admin.app` za direktno pokretanje
- `FARA Admin-1.0.0-win.zip` za Windows računar

Za Windows: raspakovati zip fajl i pokrenuti `FARA Admin.exe`.

Šta treba da radi:

- unijeti admin PIN `2026`
- prikazati iste online rezervacije kao `https://www.fara.ba/admin.html`
- prikazati statistiku zarade za dan, sedmicu i mjesec
- prikazati stalne termine po danima
- omogućiti označavanje termina kao plaćeno, otkazano ili obrisano

Šta je potrebno za instaliranu aplikaciju:

- internet konekcija
- admin PIN

Šta je potrebno samo za razvoj i ponovno pravljenje aplikacije:

- Node.js / pnpm
- pristup online API-ju `https://www.fara.ba/api/bookings`

Napomena: desktop aplikacija trenutno koristi online podatke sa FARA stranice. Ako nema interneta, neće moći učitati rezervacije.

Ako macOS prikaže upozorenje jer aplikacija nije potpisana Apple Developer certifikatom, otvoriti desni klik na aplikaciju pa `Open`.
