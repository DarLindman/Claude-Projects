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

var _fireAnimId = null;

export function startFireCanvas() {
  var canvas = document.getElementById('dash-fire-canvas');
  if (!canvas) return;
  if (_fireAnimId) return; // already running
  var ctx = canvas.getContext('2d');
  var W = canvas.width;
  var H = canvas.height;
  var particles = [];

  function spawn() {
    return {
      x: W / 2 + (Math.random() - 0.5) * 44,
      y: H - 8,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -(1.8 + Math.random() * 2.2),
      life: 1,
      decay: 0.013 + Math.random() * 0.009,
      r: 9 + Math.random() * 7
    };
  }
  // pre-seed particles at various lifecycle stages
  for (var i = 0; i < 28; i++) {
    var p = spawn();
    p.y = H - Math.random() * H * 0.75;
    p.life = Math.random();
    particles.push(p);
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    if (particles.length < 38) particles.push(spawn());
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx + Math.sin(p.y * 0.028) * 0.6;
      p.y += p.vy;
      p.life -= p.decay;
      p.r *= 0.994;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      var t = 1 - p.life; // 0=fresh 1=dying
      var r, g, b;
      if (t < 0.25)      { r = 255; g = Math.round(20 + t / 0.25 * 80);  b = 0; }
      else if (t < 0.6)  { r = 255; g = Math.round(100 + (t - 0.25) / 0.35 * 130); b = 0; }
      else               { r = 255; g = 230; b = Math.round((t - 0.6) / 0.4 * 180); }
      var alpha = p.life * 0.82;
      var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')');
      grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    _fireAnimId = requestAnimationFrame(frame);
  }
  frame();
}

export function stopFireCanvas() {
  if (_fireAnimId) { cancelAnimationFrame(_fireAnimId); _fireAnimId = null; }
  var canvas = document.getElementById('dash-fire-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
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
