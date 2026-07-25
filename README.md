# FARA stranica

Web stranica i rezervacije za FARA d.o.o. Travnik / Fara Sport Centar.

## Desktop admin aplikacija

Electron desktop aplikacija je u folderu `electron/`.

Pokretanje:

```bash
pnpm desktop
```

Šta treba da radi:

- unijeti admin PIN `2026`
- prikazati iste online rezervacije kao `https://www.fara.ba/admin.html`
- prikazati statistiku zarade za dan, sedmicu i mjesec
- prikazati stalne termine po danima
- omogućiti označavanje termina kao plaćeno, otkazano ili obrisano

Šta je potrebno na računaru:

- Node.js / pnpm
- internet konekcija
- pristup online API-ju `https://www.fara.ba/api/bookings`
- admin PIN

Napomena: desktop aplikacija trenutno koristi online podatke sa FARA stranice. Ako nema interneta, neće moći učitati rezervacije.
