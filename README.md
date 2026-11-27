# Disco Łysy

Aplikacja webowa (PWA) do prowadzenia zajęć West Coast Swing. Wklejasz link do playlisty
YouTube albo YouTube Music, a aplikacja losuje z niej kilka utworów i odtwarza każdy od początku
przez ustalony czas, z pauzą między utworami.

- działa w przeglądarce telefonu, można ją dodać do ekranu głównego (Android, później iPhone),
- bez serwera, bez logowania, bez klucza API – hosting za darmo na GitHub Pages,
- każdy instruktor używa własnych playlist; ustawienia i zapisane playlisty zostają w jego telefonie.

## Jak używać

1. Otwórz stronę aplikacji i wklej link do playlisty (publicznej albo niepublicznej, nie prywatnej),
   np. `https://music.youtube.com/playlist?list=…`. Naciśnij **Wczytaj**.
2. Ustaw: ile utworów (domyślnie 3), ile sekund gra każdy (domyślnie 90) i ile trwa pauza (domyślnie 10 s).
3. Naciśnij **Start**. Ekran nie gaśnie w trakcie rundy.
4. **Następny** przeskakuje utwór lub pauzę, **Losuj nowe** zaczyna nową rundę.

Link w postaci `https://<adres aplikacji>/?list=<ID playlisty>` od razu wczytuje playlistę,
więc można go wysłać innym instruktorom.

## Jak to działa

- Muzyka gra przez oficjalny odtwarzacz YouTube (IFrame Player API), widoczny na ekranie.
- Lista utworów jest odczytywana przez sam odtwarzacz (`cuePlaylist` + `getPlaylist`),
  więc nie potrzeba klucza API. YouTube zwraca maksymalnie 200 pierwszych pozycji playlisty.
- Czas utworu liczy się z pozycji odtwarzania, dlatego reklamy i buforowanie nie zjadają czasu.
- Utwory, których właściciel zablokował odtwarzanie poza YouTube, są pomijane i zastępowane innymi.
- Ostatnie 3 sekundy są łagodnie wyciszane (można wyłączyć).

## Reklamy i YouTube Premium

Bez YouTube Premium przed utworem może pojawić się reklama. Odtwarzacz w aplikacji korzysta
z logowania do YouTube w przeglądarce, jeśli przeglądarka na to pozwala:

- **Android / Chrome**: aplikacja dodana do ekranu głównego dzieli dane z Chrome, więc jeśli
  w Chrome jesteś zalogowany na konto z Premium, reklam nie powinno być. Do sprawdzenia na telefonie.
- **iPhone / Safari**: Safari blokuje ciasteczka YouTube w osadzonych odtwarzaczach, a aplikacja
  z ekranu głównego ma osobne dane, więc reklamy prawdopodobnie będą się pojawiać.

## Publikacja

Strona publikuje się automatycznie przez GitHub Actions po każdym pushu na `main`
(`.github/workflows/pages.yml`). Jednorazowo trzeba włączyć Pages w repozytorium:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
Adres aplikacji: `https://zgorzynb.github.io/disco_lysy/`.

## Uruchomienie lokalne

```
python3 -m http.server 8000
```

i otwórz `http://localhost:8000`.
