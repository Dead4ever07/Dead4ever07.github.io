# Dead4ever07.github.io

An interactive Three.js 3D project showcase built with zero build tools for instant deployment on GitHub Pages.

## Features

- **Real `.stl` 3D Models on Every Card**: Supports both binary and ASCII `.stl` files (`src/stl.js`), automatically centered, unit-normalized, and cached for instant filter switching.
- **Snappy 3D Stage Carousel**: Critically-damped spring physics with mouse wheel, swipe, click-to-focus, and keyboard navigation (`←`/`→`, `1`–`6`, `Enter`, `Esc`, `G`).
- **Inspect Mode**: Click the active 3D card or press `Enter` to open the project inspector and drag to orbit-inspect the `.stl` model.
- **Category Filters & Quick Index**: Filter by category in the top bar or press `G` to open the 2D overview index.
- **GitHub Pages Ready**: Plain ES Modules + `.nojekyll`.

## Using Your Own `.stl` Files

1. Put your `.stl` files into [`models/`](./models/) (or use any CORS-enabled URL).
2. Update [`src/projects.js`](./src/projects.js) with your project details and `stlUrl`:

```js
{
  id: 'my-model',
  title: 'My Hardware Build',
  // ...
  stlUrl: './models/my-model.stl',
  stlRotation: [-Math.PI / 2, 0, 0], // optional (useful for Z-up CAD exports)
  stlScale: 1.0,                       // optional size multiplier
  stlWireframe: false                  // optional wireframe overlay
}
```

## Local Preview

Serve the repository over HTTP (required for ES Modules and `fetch()`):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
