export function animateCountUp(el, target, duration) {
  duration = duration || 800;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target.toLocaleString('he-IL');
    return;
  }
  var start = performance.now();
  function tick(now) {
    var t = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(t * target).toLocaleString('he-IL');
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

let _confettiFrame = null; // module-scope so rapid calls cancel previous animation


export function spawnConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const colors = ['#E8703A','#ffe066','#5eead4','#93c5fd','#C4956A','#f5a060'];
  const particles = Array.from({ length: 22 }, () => ({
    x: (0.1 + Math.random() * 0.8) * canvas.width,
    y: -8,
    r: 3 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 3,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.2,
    alpha: 1,
    isRect: Math.random() > 0.5,
  }));
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy * 1.04; p.rot += p.vrot;
      p.alpha = Math.max(0, 1 - p.y / (canvas.height * 0.85));
      if (p.alpha > 0) alive = true;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.isRect) ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
      else { ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (alive) _confettiFrame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (_confettiFrame) cancelAnimationFrame(_confettiFrame);
  draw();
}
