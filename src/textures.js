function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  if (!text) return 0;
  const words = text.trim().split(/\s+/);
  let line = '';
  let linesDrawn = 0;

  for (let i = 0; i < words.length; i++) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + linesDrawn * lineHeight);
      linesDrawn++;
      line = words[i];
      if (linesDrawn >= maxLines - 1) {
        const rest = words.slice(i).join(' ');
        ctx.fillText(truncateToFit(ctx, rest, maxWidth), x, y + linesDrawn * lineHeight);
        return linesDrawn + 1;
      }
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, y + linesDrawn * lineHeight);
    linesDrawn++;
  }
  return linesDrawn;
}

function truncateToFit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function seededRand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Generates an archival museum exhibition plaque Canvas for the front of each stand.
 * Used both as a Three.js CanvasTexture on the 3D stand and in the 2D fallback stage.
 */
export function createProjectCardCanvas(project, index, total) {
  const width = 1024;
  const height = 680;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  const rand = seededRand((index + 1) * 7919);

  // Archival cotton museum paper background
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#f4eee2');
  bg.addColorStop(0.55, '#ede4d4');
  bg.addColorStop(1, '#e5dac7');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Subtle paper fiber texture
  for (let i = 0; i < 1600; i++) {
    const px = rand() * width;
    const py = rand() * height;
    const alpha = 0.02 + rand() * 0.035;
    ctx.fillStyle = rand() > 0.5 ? `rgba(120, 95, 65, ${alpha})` : `rgba(255, 252, 246, ${alpha})`;
    ctx.fillRect(px, py, 2, 2);
  }

  // Outer & inner museum border with dedicated corner medallions
  const outerInset = 18;
  const innerInset = 30;
  ctx.strokeStyle = '#a87e3e';
  ctx.lineWidth = 3;
  ctx.strokeRect(outerInset, outerInset, width - outerInset * 2, height - outerInset * 2);

  ctx.strokeStyle = 'rgba(139, 101, 46, 0.48)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(innerInset, innerInset, width - innerInset * 2, height - innerInset * 2);

  // Corner L-brackets and machined brass rivets (cleanly separated from frame lines)
  const bracket = 18;
  const rivetInset = 44;
  ctx.strokeStyle = '#8b6226';
  ctx.lineWidth = 2.5;
  const corners = [
    [innerInset, innerInset, 1, 1],
    [width - innerInset, innerInset, -1, 1],
    [innerInset, height - innerInset, 1, -1],
    [width - innerInset, height - innerInset, -1, -1]
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * bracket, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * bracket);
    ctx.stroke();

    const rx = cx + dx * (rivetInset - innerInset);
    const ry = cy + dy * (rivetInset - innerInset);
    ctx.beginPath();
    ctx.arc(rx, ry, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#c89b54';
    ctx.fill();
    ctx.strokeStyle = '#75531f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const padX = 76;
  const contentW = width - padX * 2;

  // Exhibit header metadata
  const idxLabel = `EXHIBIT ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  ctx.fillStyle = '#8b6226';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText(idxLabel, padX, 92);

  const metaRight = `${(project.category || 'PROJECT').toUpperCase()}  ·  ${project.year || ''}`;
  ctx.fillStyle = '#5c5246';
  ctx.font = '500 20px "IBM Plex Mono", monospace';
  const metaW = ctx.measureText(metaRight).width;
  ctx.fillText(metaRight, width - padX - metaW, 92);

  // Brass divider line
  ctx.strokeStyle = 'rgba(148, 108, 49, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, 118);
  ctx.lineTo(width - padX, 118);
  ctx.stroke();

  // Project Title in editorial serif
  ctx.fillStyle = '#1b1713';
  ctx.font = '700 54px "Fraunces", Georgia, serif';
  const titleLines = wrapText(ctx, project.title || 'Untitled Exhibit', padX, 186, contentW, 60, 2);

  // Description block (tagline + summary)
  const descParts = [];
  if (project.tagline) descParts.push(project.tagline.trim());
  if (project.summary) descParts.push(project.summary.trim());
  const description = descParts.join(' — ');

  const descY = 186 + titleLines * 60 + 18;
  ctx.fillStyle = '#3b332b';
  ctx.font = '400 28px "Inter", -apple-system, sans-serif';
  const descLines = wrapText(ctx, description, padX, descY, contentW, 40, 4);

  // Highlight bullet (first highlight if there's vertical space)
  if (Array.isArray(project.highlights) && project.highlights.length > 0 && descLines <= 3) {
    const bulletY = descY + descLines * 40 + 22;
    if (bulletY < height - 155) {
      ctx.fillStyle = '#8b6226';
      ctx.font = '600 22px "Inter", sans-serif';
      ctx.fillText('•', padX, bulletY);
      ctx.fillStyle = '#4e443a';
      ctx.font = '500 23px "Inter", sans-serif';
      wrapText(ctx, project.highlights[0], padX + 26, bulletY, contentW - 26, 32, 2);
    }
  }

  // Bottom divider
  ctx.strokeStyle = 'rgba(148, 108, 49, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, height - 122);
  ctx.lineTo(width - padX, height - 122);
  ctx.stroke();

  // Tech Stack tags along bottom left
  let pillX = padX;
  const pillY = height - 74;
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  for (const tech of (project.stack || []).slice(0, 4)) {
    const textW = ctx.measureText(tech).width;
    const boxW = textW + 26;
    if (pillX + boxW > width - 310) break;

    ctx.fillStyle = 'rgba(164, 122, 58, 0.13)';
    ctx.strokeStyle = 'rgba(139, 101, 46, 0.42)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, pillX, pillY - 24, boxW, 34, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#332b23';
    ctx.fillText(tech, pillX + 13, pillY - 1);
    pillX += boxW + 10;
  }

  // Inspect cue on bottom right
  const cue = 'CLICK TO INSPECT →';
  ctx.fillStyle = '#8b6226';
  ctx.font = '600 17px "IBM Plex Mono", monospace';
  const cueW = ctx.measureText(cue).width;
  ctx.fillText(cue, width - padX - cueW, pillY - 1);

  return canvas;
}

export function createStandPlaqueTexture(THREE, project, index, total) {
  const canvas = createProjectCardCanvas(project, index, total);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Generates a warm herringbone oak parquet floor texture for the museum gallery.
 */
export function createGalleryFloorTexture(THREE) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = seededRand(4219);

  ctx.fillStyle = '#4c3625';
  ctx.fillRect(0, 0, size, size);

  const plankW = 64;
  const plankH = 128;
  const tones = ['#5c412c', '#654831', '#533b28', '#6c4e36', '#4d3624'];

  for (let y = 0; y < size; y += plankH) {
    for (let x = 0; x < size; x += plankW) {
      const colIdx = Math.floor(rand() * tones.length);
      ctx.fillStyle = tones[colIdx];
      ctx.fillRect(x + 1, y + 1, plankW - 2, plankH - 2);

      // Wood grain streaks
      for (let g = 0; g < 16; g++) {
        const gx = x + 2 + rand() * (plankW - 4);
        ctx.strokeStyle = rand() > 0.5 ? 'rgba(30, 18, 10, 0.14)' : 'rgba(210, 168, 120, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx, y + 2);
        ctx.lineTo(gx + (rand() - 0.5) * 3, y + plankH - 2);
        ctx.stroke();
      }

      // Plank seam
      ctx.strokeStyle = 'rgba(28, 18, 10, 0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, plankW, plankH);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates a warm Venetian plaster / limestone texture for museum walls.
 */
export function createGalleryWallTexture(THREE) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = seededRand(8831);

  ctx.fillStyle = '#d7cdbd';
  ctx.fillRect(0, 0, size, size);

  // Soft limewash plaster mottling
  for (let i = 0; i < 480; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 16 + rand() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() > 0.46;
    g.addColorStop(0, light ? 'rgba(244, 237, 225, 0.14)' : 'rgba(145, 132, 114, 0.09)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine architectural ashlar stone seams
  ctx.strokeStyle = 'rgba(115, 104, 88, 0.16)';
  ctx.lineWidth = 1.5;
  for (let y = 128; y < size; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  for (let row = 0; row < 4; row++) {
    const offset = (row % 2) * 128;
    for (let x = offset; x < size; x += 256) {
      ctx.beginPath();
      ctx.moveTo(x, row * 128);
      ctx.lineTo(x, (row + 1) * 128);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

/**
 * Generates framed architectural/schematic gallery wall artwork placed between stands.
 */
export function createWallArtworkTexture(THREE, variantIndex) {
  const w = 512;
  const h = 640;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Museum mat board
  ctx.fillStyle = '#ebe3d5';
  ctx.fillRect(0, 0, w, h);

  // Inner print area
  ctx.fillStyle = '#1f1c18';
  ctx.fillRect(58, 68, w - 116, h - 156);

  ctx.strokeStyle = '#c89b54';
  ctx.lineWidth = 2;
  ctx.strokeRect(72, 82, w - 144, h - 184);

  const cx = w / 2;
  const cy = 290;
  const mode = variantIndex % 4;

  ctx.strokeStyle = '#e5dccb';
  ctx.fillStyle = '#d4a359';
  ctx.lineWidth = 2;

  if (mode === 0) {
    // PCB / Trace study
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(110, cy + i * 28);
      ctx.lineTo(185 + Math.abs(i) * 14, cy + i * 28);
      ctx.lineTo(235 + Math.abs(i) * 14, cy + i * 16);
      ctx.lineTo(w - 110, cy + i * 16);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(110, cy + i * 28, 4, 0, Math.PI * 2);
      ctx.arc(w - 110, cy + i * 16, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#d4a359';
    ctx.strokeRect(cx - 42, cy - 42, 84, 84);
  } else if (mode === 1) {
    // Harmonic circles study
    for (let r = 28; r <= 120; r += 23) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = '#d4a359';
    ctx.beginPath();
    ctx.moveTo(110, cy);
    ctx.lineTo(w - 110, cy);
    ctx.moveTo(cx, 130);
    ctx.lineTo(cx, 450);
    ctx.stroke();
  } else if (mode === 2) {
    // Waveform / Oscilloscope plate
    ctx.beginPath();
    for (let x = 100; x <= w - 100; x += 4) {
      const t = (x - 100) / (w - 200);
      const y = cy + Math.sin(t * Math.PI * 6) * Math.sin(t * Math.PI) * 95;
      if (x === 100) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#d4a359';
    ctx.beginPath();
    ctx.moveTo(100, cy);
    ctx.lineTo(w - 100, cy);
    ctx.stroke();
  } else {
    // Architectural grid & isometric cube
    const r = 85;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = '#d4a359';
    for (let i = 0; i < 6; i += 2) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
  }

  // Gallery plate caption under print
  ctx.fillStyle = '#4a4035';
  ctx.font = '500 16px "IBM Plex Mono", monospace';
  const plateLabel = `ARCHIVE PLATE // NO. 0${variantIndex + 1}`;
  const lw = ctx.measureText(plateLabel).width;
  ctx.fillText(plateLabel, (w - lw) / 2, h - 42);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Generates a soft radial contact-shadow alpha texture.
 */
export function createSoftShadowTexture(THREE) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(10, 7, 4, 0.62)');
  g.addColorStop(0.55, 'rgba(10, 7, 4, 0.25)');
  g.addColorStop(1, 'rgba(10, 7, 4, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
