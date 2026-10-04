# Third-party notices

DailyHouse is customized from the LShu workbench. The original MIT copyright and license remain in [LICENSE](LICENSE). Package dependencies retain their own upstream licenses; the backend/frontend package manifests and lockfiles identify the current versions.

Current runtime dependencies include React, React DOM, React Router, Pixelarticons, Express, node-ical and dotenv. Development dependencies include TypeScript, Vite, Vitest, jsdom, tsx and PGlite. Retired SQLite, charting and upload packages are not current dependencies. Consult installed packages for their authoritative license texts.

Bundled assets:

- Fusion Pixel font files are redistributed under the [SIL Open Font License](frontend/src/assets/fonts/OFL.txt). Retain the included component-font notices in `frontend/src/assets/fonts/LICENSES/` for ark-pixel, cubic-11 and Galmuri; these are legal notices, not obsolete development records.
- Pixelarticons is supplied by the locked npm dependency under its MIT license. The garden favicon derives from its tree icon and retains that attribution; there is no separate copied Pixelarticons asset directory.
- Garden landscapes, keeper and tomato atlas were generated with the built-in ImageGen tool. Exact prompts and provenance are retained in [artwork.md](docs/artwork.md) and `docs/prompts/`.
- The launcher cottage/planter mark, geometric textures and authored pixel UI shapes are original project artwork distributed under the project MIT license. No game screenshots, characters or official game assets were copied.

Downloaded local-model and runtime files are not bundled with source. Consult their publishers' licenses when installing them. No personal photos, downloaded video frames, private documents or acceptance screenshots are included in source.
