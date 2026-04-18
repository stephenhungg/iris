# iris — frontend

Vite + React + TypeScript. Zero-config — no Tailwind, no component library.
The aesthetic lives in `src/styles/global.css` (editorial cinema / darkroom).

## dev

```bash
cd frontend
npm install
npm run dev
```

Dev server runs at `http://localhost:5173` and proxies `/api` + `/media`
to the backend at `http://localhost:8000` (see `vite.config.ts`).

Start the backend in another terminal:

```bash
./scripts/dev_backend.sh
```

Stub mode is on by default so you can click through the full loop without
any API keys.

## layout

```
src/
├── App.tsx              toggles between Landing and Editor
├── main.tsx             entrypoint
├── api/client.ts        fetch wrapper + session-id + endpoint typings
├── components/
│   ├── Aperture.tsx     six-blade iris hero graphic (pure SVG + CSS)
│   └── BBoxCanvas.tsx   drag-to-draw bounding box overlay
├── pages/
│   ├── Landing.tsx      hero, spec strip, CTAs
│   └── Editor.tsx       upload → prompt → variants → accept loop
└── styles/global.css    design tokens, type, grain, primitives
```

## design

- **Fonts**: Fraunces (expressive variable serif, italic display) + JetBrains Mono
- **Palette**: darkroom ink `#0f0e0d`, aged paper `#f2ead9`, safelight `#ff5722`, brass `#c9a96e`
- **Motion**: aperture-opens-on-load hero, staggered copy reveal, scanline
  during generation, grain overlay throughout
- **No gradients-as-decoration**, no purple, no Inter.
