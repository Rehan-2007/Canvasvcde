import { Stroke, Point } from '../types.js';

export const CANVAS_WIDTH = 3840;
export const CANVAS_HEIGHT = 2160;

/**
 * Transforms screen mouse/touch coordinates to canvas coordinates given zoom and pan.
 */
export function screenToCanvas(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  zoom: number,
  pan: { x: number; y: number }
): Point {
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;
  return {
    x: (relX - pan.x) / zoom,
    y: (relY - pan.y) / zoom,
  };
}

/**
 * Transforms canvas coordinates to screen coordinates.
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  zoom: number,
  pan: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: canvasX * zoom + pan.x,
    y: canvasY * zoom + pan.y,
  };
}

/**
 * Renders a single stroke onto the provided 2D canvas context.
 */
export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.isUndone) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = stroke.opacity ?? 1;

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }

  ctx.lineWidth = stroke.size;

  // 1. Shapes
  if (stroke.shapeData) {
    const { startX, startY, endX, endY, text, filled } = stroke.shapeData;

    if (stroke.tool === 'rectangle') {
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(endX - startX);
      const h = Math.abs(endY - startY);
      if (filled) {
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeRect(x, y, w, h);
    } else if (stroke.tool === 'circle') {
      const rx = Math.abs(endX - startX) / 2;
      const ry = Math.abs(endY - startY) / 2;
      const cx = Math.min(startX, endX) + rx;
      const cy = Math.min(startY, endY) + ry;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (filled) {
        ctx.fill();
      }
      ctx.stroke();
    } else if (stroke.tool === 'triangle') {
      const topX = (startX + endX) / 2;
      const topY = startY;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(endX, endY);
      ctx.lineTo(startX, endY);
      ctx.closePath();
      if (filled) {
        ctx.fill();
      }
      ctx.stroke();
    } else if (stroke.tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    } else if (stroke.tool === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLength = Math.max(12, stroke.size * 2.5);
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - headLength * Math.cos(angle - Math.PI / 6),
        endY - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        endX - headLength * Math.cos(angle + Math.PI / 6),
        endY - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    } else if (stroke.tool === 'text' && text) {
      const fontSize = Math.max(14, stroke.size * 3.5);
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(text, startX, startY);
    }

    ctx.restore();
    return;
  }

  // 2. Freehand curves (pen, brush, eraser)
  const pts = stroke.points;
  if (!pts || pts.length === 0) {
    ctx.restore();
    return;
  }

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (stroke.tool === 'brush') {
    ctx.shadowBlur = stroke.size * 0.4;
    ctx.shadowColor = stroke.color;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    // Smooth quadratic curve interpolation
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * High-performance Flood Fill (Bucket) implementation using Scanline Fill.
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColorHex: string,
  opacity: number = 1
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const x = Math.floor(startX);
  const y = Math.floor(startY);

  if (x < 0 || x >= width || y < 0 || y >= height) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Parse fill color
  const tempDiv = document.createElement('div');
  tempDiv.style.color = fillColorHex;
  document.body.appendChild(tempDiv);
  const computedColor = window.getComputedStyle(tempDiv).color;
  document.body.removeChild(tempDiv);

  const match = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return;

  const targetR = parseInt(match[1], 10);
  const targetG = parseInt(match[2], 10);
  const targetB = parseInt(match[3], 10);
  const targetA = Math.round((match[4] !== undefined ? parseFloat(match[4]) : 1) * opacity * 255);

  const startPos = (y * width + x) * 4;
  const startR = data[startPos];
  const startG = data[startPos + 1];
  const startB = data[startPos + 2];
  const startA = data[startPos + 3];

  // If start color is already close to target color, return
  if (
    Math.abs(startR - targetR) < 10 &&
    Math.abs(startG - targetG) < 10 &&
    Math.abs(startB - targetB) < 10 &&
    Math.abs(startA - targetA) < 10
  ) {
    return;
  }

  const colorMatch = (pos: number) => {
    const r = data[pos];
    const g = data[pos + 1];
    const b = data[pos + 2];
    const a = data[pos + 3];
    return (
      Math.abs(r - startR) <= 32 &&
      Math.abs(g - startG) <= 32 &&
      Math.abs(b - startB) <= 32 &&
      Math.abs(a - startA) <= 32
    );
  };

  const queue: [number, number][] = [[x, y]];
  const visited = new Uint8Array(width * height);

  while (queue.length > 0) {
    const [curX, curY] = queue.pop()!;
    const pixelIndex = curY * width + curX;

    if (visited[pixelIndex]) continue;
    visited[pixelIndex] = 1;

    const pos = pixelIndex * 4;
    data[pos] = targetR;
    data[pos + 1] = targetG;
    data[pos + 2] = targetB;
    data[pos + 3] = targetA;

    // Check neighbors
    if (curX > 0 && !visited[pixelIndex - 1] && colorMatch(pos - 4)) {
      queue.push([curX - 1, curY]);
    }
    if (curX < width - 1 && !visited[pixelIndex + 1] && colorMatch(pos + 4)) {
      queue.push([curX + 1, curY]);
    }
    if (curY > 0 && !visited[pixelIndex - width] && colorMatch(pos - width * 4)) {
      queue.push([curX, curY - 1]);
    }
    if (curY < height - 1 && !visited[pixelIndex + width] && colorMatch(pos + width * 4)) {
      queue.push([curX, curY + 1]);
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Export canvas to SVG string format.
 */
export function exportStrokesToSVG(strokes: Stroke[], width = CANVAS_WIDTH, height = CANVAS_HEIGHT): string {
  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n`;
  svgContent += `<rect width="${width}" height="${height}" fill="#09090b" />\n`;

  for (const stroke of strokes) {
    if (stroke.isUndone || stroke.tool === 'eraser') continue;

    const color = stroke.color;
    const opacity = stroke.opacity ?? 1;
    const size = stroke.size;

    if (stroke.shapeData) {
      const { startX, startY, endX, endY, filled, text } = stroke.shapeData;
      if (stroke.tool === 'rectangle') {
        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const w = Math.abs(endX - startX);
        const h = Math.abs(endY - startY);
        svgContent += `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${filled ? color : 'none'}" stroke="${color}" stroke-width="${size}" opacity="${opacity}" />\n`;
      } else if (stroke.tool === 'circle') {
        const rx = Math.abs(endX - startX) / 2;
        const ry = Math.abs(endY - startY) / 2;
        const cx = Math.min(startX, endX) + rx;
        const cy = Math.min(startY, endY) + ry;
        svgContent += `  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${filled ? color : 'none'}" stroke="${color}" stroke-width="${size}" opacity="${opacity}" />\n`;
      } else if (stroke.tool === 'line' || stroke.tool === 'arrow') {
        svgContent += `  <line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="${color}" stroke-width="${size}" stroke-linecap="round" opacity="${opacity}" />\n`;
      } else if (stroke.tool === 'text' && text) {
        svgContent += `  <text x="${startX}" y="${startY}" fill="${color}" font-size="${size * 3.5}" opacity="${opacity}">${text}</text>\n`;
      }
    } else if (stroke.points && stroke.points.length > 0) {
      const pts = stroke.points;
      let pathData = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        pathData += ` L ${pts[i].x} ${pts[i].y}`;
      }
      svgContent += `  <path d="${pathData}" stroke="${color}" stroke-width="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />\n`;
    }
  }

  svgContent += `</svg>`;
  return svgContent;
}
