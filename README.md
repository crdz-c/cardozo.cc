# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

For now it is a single static page: name, one-line intro and contacts. No build step, no dependencies.
This repo is where the full site (portfolio, case studies) will live later.

```
index.html   the page
style.css    styles (tokens mirror the former Astro rebuild: black page, Kanit, white-opacity ramp)
fonts/       Kanit 300/500, self-hosted
CNAME        custom domain for GitHub Pages
```

## Develop

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions of the site (the August 2025 portfolio page and the Astro rebuild archived from the
private `cardozo-portfolio` repo) are in the git history and in the `cardozo-portfolio-2026-11-04.bundle` backup.
