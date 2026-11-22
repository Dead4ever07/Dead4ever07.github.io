function hexToRgba(hex, alpha) {
  const clean = (hex || '#38bdf8').replace('#', '');
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Generates a crisp high-DPI HTML5 Canvas for each project card.
 * Used both as a Three.js CanvasTexture and in the 2D fallback stage.
 */
export function createProjectCardCanvas(project, index, total) {
  const width = 768;
  const height = 960;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  const accent = project.accent || '#38bdf8';

  // Deep obsidian background gradient
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0c101b');
  bg.addColorStop(0.55, '#070910');
  bg.addColorStop(1, '#040509');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Subtle accent glow
  const glow = ctx.createRadialGradient(
    width * 0.5,
    height * 0.36,
    10,
    width * 0.5,
    height * 0.36,
    360
  );
  glow.addColorStop(0, hexToRgba(accent, 0.24));
  glow.addColorStop(0.6, hexToRgba(accent, 0.06));
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Technical grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  ctx.lineWidth = 1;
  const step = 48;
  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Framing border
  ctx.strokeStyle = hexToRgba(accent, 0.38);
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  // Corner ticks
  const tick = 26;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  const corners = [
    [20, 20, 1, 1],
    [width - 20, 20, -1, 1],
    [20, height - 20, 1, -1],
    [width - 20, height - 20, -1, -1]
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * tick);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * tick, cy);
    ctx.stroke();
  }

  // Top metadata header
  const idxLabel = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  ctx.fillStyle = accent;
  ctx.font = '600 22px "JetBrains Mono", monospace';
  ctx.fillText(idxLabel, 54, 78);

  ctx.fillStyle = 'rgba(243, 245, 248, 0.65)';
  ctx.font = '500 20px "JetBrains Mono", monospace';
  const catText = project.category.toUpperCase();
  const catWidth = ctx.measureText(catText).width;
  ctx.fillText(catText, width - 54 - catWidth, 78);

  // Divider below header
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(54, 102);
  ctx.lineTo(width - 54, 102);
  ctx.stroke();

  // Center reticle ring behind the 3D centerpiece
  ctx.save();
  ctx.translate(width / 2, height * 0.4);
  ctx.strokeStyle = hexToRgba(accent, 0.22);
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 10]);
  ctx.beginPath();
  ctx.arc(0, 0, 188, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 224, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Bottom text block
  ctx.fillStyle = 'rgba(243, 245, 248, 0.5)';
  ctx.font = '500 20px "JetBrains Mono", monospace';
  ctx.fillText(`YEAR // ${project.year}`, 54, height - 208);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 48px "Space Grotesk", "Inter", sans-serif';
  wrapText(ctx, project.title, 54, height - 150, width - 108, 54, 2);

  // Stack pills along the bottom
  let pillX = 54;
  const pillY = height - 74;
  ctx.font = '500 18px "JetBrains Mono", monospace';
  for (const tech of project.stack.slice(0, 3)) {
    const label = tech;
    const textW = ctx.measureText(label).width;
    const boxW = textW + 26;
    if (pillX + boxW > width - 54) break;

    ctx.fillStyle = hexToRgba(accent, 0.14);
    ctx.strokeStyle = hexToRgba(accent, 0.42);
    ctx.lineWidth = 1.5;
    roundRect(ctx, pillX, pillY - 24, boxW, 34, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(label, pillX + 13, pillY - 1);
    pillX += boxW + 12;
  }

  return canvas;
}

export function createProjectCardTexture(THREE, project, index, total) {
  const canvas = createProjectCardCanvas(project, index, total);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(' ');
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
        return;
      }
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, y + linesDrawn * lineHeight);
  }
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
