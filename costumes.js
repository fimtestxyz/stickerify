// Cartoon body costumes for Stickerify.
// Each costume dresses a head cut-out up: the head is pasted onto a cute
// cartoon body drawn with plain canvas vector shapes — no image assets, so
// everything stays on-device and crisp at any size.
//
// A costume has three layers, all drawn in the sticker canvas's coordinates:
//   drawBack(ctx, head, body)  — behind the head (cape, ears, tail)
//   drawBody(ctx, head, body)  — the body itself, below the head
//   drawFront(ctx, head, body) — over the head (helmet ring, party hat)
// `head` and `body` are rects {x, y, w, h}. The body rect sits below the
// head with a small overlap so the chin tucks behind the collar.
const INK = "#2b2118"; // cartoon outline colour

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function ell(ctx, cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
}

function star(ctx, cx, cy, rO, rI, n = 5) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rO : rI;
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Cartoon stroke: thick dark outline, round joins. Scale from a width. */
function outline(ctx, w) {
  ctx.lineWidth = Math.max(2, w * 0.03);
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

export const COSTUMES = [
  {
    id: "superhero",
    name: "Superhero",
    drawBack(ctx, head, body) {
      const { x, y, w, h } = body;
      outline(ctx, w);
      ctx.fillStyle = "#e63946";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.16, y + h * 0.06);
      ctx.quadraticCurveTo(x - w * 0.06, y + h * 0.45, x + w * 0.02, y + h * 0.96);
      ctx.quadraticCurveTo(x + w * 0.5, y + h * 1.02, x + w * 0.98, y + h * 0.96);
      ctx.quadraticCurveTo(x + w * 1.06, y + h * 0.45, x + w * 0.84, y + h * 0.06);
      ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.16, x + w * 0.16, y + h * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    },
    drawBody(ctx, head, body) {
      const { x, y, w, h } = body;
      outline(ctx, w);
      // arms
      ctx.fillStyle = "#4361ee";
      ell(ctx, x + w * 0.06, y + h * 0.42, w * 0.075, h * 0.24); ctx.fill(); ctx.stroke();
      ell(ctx, x + w * 0.94, y + h * 0.42, w * 0.075, h * 0.24); ctx.fill(); ctx.stroke();
      // legs
      rr(ctx, x + w * 0.26, y + h * 0.62, w * 0.2, h * 0.3, w * 0.06); ctx.fill(); ctx.stroke();
      rr(ctx, x + w * 0.54, y + h * 0.62, w * 0.2, h * 0.3, w * 0.06); ctx.fill(); ctx.stroke();
      // boots
      ctx.fillStyle = "#e63946";
      rr(ctx, x + w * 0.24, y + h * 0.86, w * 0.24, h * 0.14, w * 0.05); ctx.fill(); ctx.stroke();
      rr(ctx, x + w * 0.52, y + h * 0.86, w * 0.24, h * 0.14, w * 0.05); ctx.fill(); ctx.stroke();
      // torso
      ctx.fillStyle = "#4361ee";
      rr(ctx, x + w * 0.1, y, w * 0.8, h * 0.68, w * 0.16); ctx.fill(); ctx.stroke();
      // belt
      ctx.fillStyle = "#ffd60a";
      ctx.fillRect(x + w * 0.1, y + h * 0.56, w * 0.8, h * 0.07);
      ctx.strokeRect(x + w * 0.1, y + h * 0.56, w * 0.8, h * 0.07);
      // chest emblem
      star(ctx, x + w * 0.5, y + h * 0.3, w * 0.17, w * 0.075);
      ctx.fill(); ctx.stroke();
    },
    drawFront() {},
  },
  {
    id: "astronaut",
    name: "Astronaut",
    drawBack(ctx, head, body) {
      const { x, y, w, h } = body;
      outline(ctx, w);
      ctx.fillStyle = "#dfe3e6";
      rr(ctx, x - w * 0.04, y + h * 0.06, w * 0.24, h * 0.46, w * 0.06); ctx.fill(); ctx.stroke();
      rr(ctx, x + w * 0.8, y + h * 0.06, w * 0.24, h * 0.46, w * 0.06); ctx.fill(); ctx.stroke();
    },
    drawBody(ctx, head, body) {
      const { x, y, w, h } = body;
      outline(ctx, w);
      // arms
      ctx.fillStyle = "#f4f6f7";
      rr(ctx, x + w * 0.04, y + h * 0.18, w * 0.13, h * 0.5, w * 0.06); ctx.fill(); ctx.stroke();
      rr(ctx, x + w * 0.83, y + h * 0.18, w * 0.13, h * 0.5, w * 0.06); ctx.fill(); ctx.stroke();
      // legs + boots
      rr(ctx, x + w * 0.26, y + h * 0.6, w * 0.2, h * 0.3, w * 0.06); ctx.fill(); ctx.stroke();
      rr(ctx, x + w * 0.54, y + h * 0.6, w * 0.2, h * 0.3, w * 0.06); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#9aa5ab";
      rr(ctx, x + w * 0.24, y + h * 0.86, w * 0.24, h * 0.14, w * 0.05); ctx.fill(); ctx.stroke();
      rr(ctx, x + w * 0.52, y + h * 0.86, w * 0.24, h * 0.14, w * 0.05); ctx.fill(); ctx.stroke();
      // torso
      ctx.fillStyle = "#f4f6f7";
      rr(ctx, x + w * 0.1, y, w * 0.8, h * 0.68, w * 0.16); ctx.fill(); ctx.stroke();
      // chest panel + buttons
      ctx.fillStyle = "#cfd8dc";
      rr(ctx, x + w * 0.34, y + h * 0.26, w * 0.32, h * 0.2, w * 0.04); ctx.fill(); ctx.stroke();
      const btns = ["#e63946", "#2ec4b6", "#4361ee"];
      btns.forEach((col, i) => {
        ctx.fillStyle = col;
        ell(ctx, x + w * (0.4 + i * 0.1), y + h * 0.36, w * 0.035, w * 0.035);
        ctx.fill(); ctx.stroke();
      });
      // red stripe
      ctx.fillStyle = "#e63946";
      ctx.fillRect(x + w * 0.1, y + h * 0.52, w * 0.8, h * 0.06);
    },
    drawFront(ctx, head) {
      // Helmet ring framing the face, plus antenna.
      const cx = head.x + head.w / 2, cy = head.y + head.h / 2;
      const r = Math.hypot(head.w, head.h) * 0.52;
      ctx.lineWidth = Math.max(3, head.w * 0.07);
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(2, head.w * 0.02);
      ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.arc(cx, cy, r + head.w * 0.035, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r - head.w * 0.035, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(2, head.w * 0.03);
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.7, cy - r * 0.7);
      ctx.lineTo(cx + r * 0.95, cy - r * 1.05);
      ctx.stroke();
      ctx.fillStyle = "#e63946";
      ell(ctx, cx + r * 0.95, cy - r * 1.05, head.w * 0.04, head.w * 0.04);
      ctx.fill(); ctx.stroke();
    },
  },
  {
    id: "bunny",
    name: "Bunny",
    drawBack(ctx, head) {
      // Long ears behind the head.
      const cx = head.x + head.w / 2;
      const earW = head.w * 0.17, earH = head.h * 0.62;
      outline(ctx, head.w);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(cx + s * head.w * 0.24, head.y - earH * 0.28);
        ctx.rotate(s * 0.16);
        ctx.fillStyle = "#fffaf0";
        ell(ctx, 0, 0, earW / 2, earH / 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ffb3c6";
        ell(ctx, 0, 0, earW * 0.28, earH * 0.32);
        ctx.fill();
        ctx.restore();
      }
    },
    drawBody(ctx, head, body) {
      const { x, y, w, h } = body;
      outline(ctx, w);
      // paws
      ctx.fillStyle = "#fffaf0";
      ell(ctx, x + w * 0.26, y + h * 0.92, w * 0.11, h * 0.06); ctx.fill(); ctx.stroke();
      ell(ctx, x + w * 0.74, y + h * 0.92, w * 0.11, h * 0.06); ctx.fill(); ctx.stroke();
      // fluffy torso + belly
      ell(ctx, x + w * 0.5, y + h * 0.52, w * 0.42, h * 0.46); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffd6e0";
      ell(ctx, x + w * 0.5, y + h * 0.6, w * 0.26, h * 0.3); ctx.fill();
      // bow tie at the neck
      ctx.fillStyle = "#ff5d8f";
      const ty = y + h * 0.08, tx = x + w * 0.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - w * 0.12, ty - h * 0.05); ctx.lineTo(tx - w * 0.12, ty + h * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + w * 0.12, ty - h * 0.05); ctx.lineTo(tx + w * 0.12, ty + h * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ell(ctx, tx, ty, w * 0.03, w * 0.03); ctx.fill(); ctx.stroke();
    },
    drawFront(ctx, head, body) {
      // Carrot held at the belly.
      const { x, y, w, h } = body;
      const cx = x + w * 0.68, cy = y + h * 0.62;
      outline(ctx, w);
      ctx.fillStyle = "#ff8c42";
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.07, cy - h * 0.08);
      ctx.lineTo(cx + w * 0.07, cy - h * 0.08);
      ctx.lineTo(cx, cy + h * 0.14);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.03, cy - h * 0.02); ctx.lineTo(cx + w * 0.03, cy - h * 0.02); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - w * 0.02, cy + h * 0.04); ctx.lineTo(cx + w * 0.02, cy + h * 0.04); ctx.stroke();
      ctx.fillStyle = "#58b368";
      ell(ctx, cx - w * 0.03, cy - h * 0.11, w * 0.03, h * 0.05); ctx.fill();
      ell(ctx, cx + w * 0.03, cy - h * 0.11, w * 0.03, h * 0.05); ctx.fill();
    },
  },
  {
    id: "dino",
    name: "Dino",
    drawBack(ctx, head, body) {
      const { x, y, w, h } = body;
      outline(ctx, w);
      // tail curving out to the right
      ctx.fillStyle = "#7bc950";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.82, y + h * 0.62);
      ctx.quadraticCurveTo(x + w * 1.12, y + h * 0.6, x + w * 1.14, y + h * 0.86);
      ctx.quadraticCurveTo(x + w * 0.98, y + h * 0.92, x + w * 0.86, y + h * 0.82);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // back spikes
      ctx.fillStyle = "#ffd60a";
      for (let i = 0; i < 3; i++) {
        const sx = x + w * (0.3 + i * 0.2);
        ctx.beginPath();
        ctx.moveTo(sx - w * 0.05, y + h * 0.06);
        ctx.lineTo(sx, y - h * 0.06);
        ctx.lineTo(sx + w * 0.05, y + h * 0.06);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    },
    drawBody(ctx, head, body) {
      const { x, y, w, h } = body;
      outline(ctx, w);
      // feet
      ctx.fillStyle = "#4c9a2a";
      ell(ctx, x + w * 0.3, y + h * 0.95, w * 0.14, h * 0.06); ctx.fill(); ctx.stroke();
      ell(ctx, x + w * 0.7, y + h * 0.95, w * 0.14, h * 0.06); ctx.fill(); ctx.stroke();
      // little arms
      ctx.fillStyle = "#7bc950";
      ell(ctx, x + w * 0.1, y + h * 0.5, w * 0.07, h * 0.12); ctx.fill(); ctx.stroke();
      ell(ctx, x + w * 0.9, y + h * 0.5, w * 0.07, h * 0.12); ctx.fill(); ctx.stroke();
      // torso + belly
      ell(ctx, x + w * 0.5, y + h * 0.5, w * 0.4, h * 0.48); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#d9f99d";
      ell(ctx, x + w * 0.5, y + h * 0.58, w * 0.24, h * 0.32); ctx.fill();
    },
    drawFront(ctx, head) {
      // Party hat on the head.
      const cx = head.x + head.w * 0.62, topY = head.y - head.h * 0.34;
      outline(ctx, head.w);
      ctx.fillStyle = "#ff5d8f";
      ctx.beginPath();
      ctx.moveTo(cx - head.w * 0.16, head.y + head.h * 0.02);
      ctx.lineTo(cx + head.w * 0.05, topY);
      ctx.lineTo(cx + head.w * 0.2, head.y + head.h * 0.02);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffd60a";
      ell(ctx, cx + head.w * 0.05, topY, head.w * 0.045, head.w * 0.045); ctx.fill(); ctx.stroke();
    },
  },
];
