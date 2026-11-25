import { clamp, formatDistance, formatTime, TAU } from '../core/math.js';
import { Rng } from '../core/rng.js';
import { COMMODITIES } from '../world/materials.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function percent(value) {
  return `${Math.round(clamp(value, 0, 100))}%`;
}

export class UI {
  constructor() {
    this.el = {
      credits: $('credits'), sector: $('sector'), simRate: $('sim-rate'), clock: $('clock'), mode: $('mode'),
      hullBar: $('hull-bar'), hullVal: $('hull-val'), fuelBar: $('fuel-bar'), fuelVal: $('fuel-val'),
      energyBar: $('energy-bar'), energyVal: $('energy-val'), heatBar: $('heat-bar'), heatVal: $('heat-val'),
      cargoUsed: $('cargo-used'), cargoList: $('cargo-list'), objective: $('objective'),
      targetName: $('target-name'), altitude: $('altitude'), speed: $('speed'), verticalSpeed: $('vertical-speed'),
      gravity: $('gravity'), alignment: $('alignment'), landingState: $('landing-state'),
      toolName: $('tool-name'), gearState: $('gear-state'), scoopState: $('scoop-state'), threatCount: $('threat-count'),
      discovered: $('discovered'), landingGuide: $('landing-guide'), guideVs: $('guide-vs'), guideHs: $('guide-hs'),
      guideAlign: $('guide-align'), guideVerdict: $('guide-verdict'), log: $('log'), hint: $('hint'),
      trade: $('trade'), help: $('help'), map: $('map'), pause: $('pause-banner'),
      marketName: $('market-name'), marketCopy: $('market-copy'), marketGrid: $('market-grid'), marketActions: $('market-actions'),
      mapCanvas: $('map-canvas')
    };
    this.mapCtx = this.el.mapCanvas.getContext('2d');
    this.mapCtx.imageSmoothingEnabled = false;
    const starRng = new Rng(0x5727);
    this.mapStars = Array.from({ length: 130 }, () => ({
      x: starRng.range(0, this.el.mapCanvas.width),
      y: starRng.range(0, this.el.mapCanvas.height),
      a: starRng.range(0.15, 0.8),
      p: starRng.range(0, TAU)
    }));
    this.helpOpen = false;
    this.mapOpen = false;
    this.tradeOpen = false;
    this.logEntries = [];
    this.logDirty = true;
    this.updateTimer = 0;
    this.mapTimer = 0;
    this.hintTimer = 20;
    this.audio = null;
    this.bindClosers();
  }

  bind(trade, audio) {
    this.trade = trade;
    this.audio = audio;
    this.el.marketActions.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled || !this.trade) return;
      this.trade.action(button.dataset.action);
    });
  }

  bindClosers() {
    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.close;
        this.audio?.play('ui');
        if (target === 'trade') this.trade?.close();
        else if (target === 'help') this.toggleHelp(false);
        else if (target === 'map') this.toggleMap(false);
      });
    });
  }

  toggleHelp(force) {
    this.helpOpen = force ?? !this.helpOpen;
    this.el.help.classList.toggle('hidden', !this.helpOpen);
  }

  toggleMap(force) {
    this.mapOpen = force ?? !this.mapOpen;
    this.el.map.classList.toggle('hidden', !this.mapOpen);
    this.mapTimer = 0;
  }

  showTrade(open) {
    this.tradeOpen = open;
    this.el.trade.classList.toggle('hidden', !open);
  }

  log(text, tone = '') {
    this.logEntries.push({ text, tone, life: 7.5 });
    if (this.logEntries.length > 7) this.logEntries.shift();
    this.logDirty = true;
    this.renderLog();
  }

  renderLog() {
    this.el.log.innerHTML = this.logEntries.map((entry) => `<div class="${escapeHtml(entry.tone)}">${escapeHtml(entry.text)}</div>`).join('');
    this.logDirty = false;
  }

  setText(id, value) {
    const el = this.el[id];
    if (el && el.textContent !== value) el.textContent = value;
  }

  setBar(barId, valueId, value, danger = false) {
    const bar = this.el[barId];
    if (!bar) return;
    bar.style.width = percent(value);
    bar.classList.toggle('danger', danger);
    this.setText(valueId, percent(value));
  }

  renderTrade(trade) {
    const data = trade.getMarketData();
    const body = data.dock?.body;
    this.setText('marketName', body?.name || 'NO MARKET LINK');
    if (this.el.marketCopy) {
      this.el.marketCopy.textContent = `${body?.description || ''}  ·  STRUCTURAL INTEGRITY ${(data.integrity * 100).toFixed(0)}%  ·  ${data.credits} CR AVAILABLE`;
    }
    this.el.marketGrid.innerHTML = data.commodities.map((c) => `
      <div class="market-cell">
        <span style="color:${c.color}">${escapeHtml(c.name)}</span>
        <b>${c.units.toFixed(1)} u <em>@ ${c.price} CR</em></b>
        <span>VALUE ${c.value} CR</span>
      </div>
    `).join('');
    this.el.marketActions.innerHTML = data.actions.map((a) => `
      <button data-action="${a.id}" ${a.enabled ? '' : 'disabled'}>
        ${escapeHtml(a.label)}
        <small>${escapeHtml(a.detail)}</small>
      </button>
    `).join('');
  }

  drawMap(world, ship, combat, renderer, time) {
    const ctx = this.mapCtx;
    const W = this.el.mapCanvas.width;
    const H = this.el.mapCanvas.height;
    const pad = 20;
    const scale = Math.min((W - pad * 2) / (world.bounds.maxX - world.bounds.minX), (H - pad * 2) / (world.bounds.maxY - world.bounds.minY));
    const sx = (x) => W / 2 + x * scale;
    const sy = (y) => H / 2 + y * scale;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#030814';
    ctx.fillRect(0, 0, W, H);

    for (const s of this.mapStars) {
      ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(time * 0.8 + s.p));
      ctx.fillStyle = '#b7eaff';
      ctx.fillRect(s.x | 0, s.y | 0, 1, 1);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(90, 160, 190, 0.10)';
    ctx.lineWidth = 1;
    for (let x = -8000; x <= 8000; x += 2000) {
      ctx.beginPath(); ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), H); ctx.stroke();
    }
    for (let y = -8000; y <= 8000; y += 2000) {
      ctx.beginPath(); ctx.moveTo(0, sy(y)); ctx.lineTo(W, sy(y)); ctx.stroke();
    }

    // Luna and the continuous hauled-asteroid belt.
    const mx = sx(world.moon.x);
    const my = sy(world.moon.y);
    const mr = world.moon.radius * scale;
    const moonGrad = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.08, mx, my, mr);
    moonGrad.addColorStop(0, 'rgba(200,220,240,0.42)');
    moonGrad.addColorStop(1, 'rgba(40,54,76,0.16)');
    ctx.fillStyle = moonGrad;
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(180,215,245,0.28)';
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = 'rgba(140,234,255,0.25)';
    for (const r of [world.belt.radius - world.belt.width / 2, world.belt.radius, world.belt.radius + world.belt.width / 2]) {
      ctx.beginPath(); ctx.arc(mx, my, r * scale, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    const sunX = clamp(sx(world.star.x), 14, W - 14);
    const sunY = clamp(sy(world.star.y), 14, H - 14);
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 52);
    glow.addColorStop(0, 'rgba(255, 210, 130, 0.65)');
    glow.addColorStop(0.25, 'rgba(255, 150, 80, 0.18)');
    glow.addColorStop(1, 'rgba(255, 120, 60, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 52, sunY - 52, 104, 104);
    ctx.fillStyle = '#ffd38a';
    ctx.fillRect(sunX - 2, sunY - 2, 4, 4);

    for (const hauler of world.haulers) {
      const tow = world.recordsById.get(hauler.towId);
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#ffc66d';
      ctx.setLineDash([2, 4]);
      if (tow) {
        ctx.beginPath();
        ctx.moveTo(sx(hauler.x), sy(hauler.y));
        ctx.lineTo(sx(tow.x), sy(tow.y));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffc66d';
      ctx.fillRect(sx(hauler.x) - 2, sy(hauler.y) - 2, 4, 4);
      ctx.restore();
    }

    for (const body of world.tracked) {
      const x = sx(body.x);
      const y = sy(body.y);
      const r = Math.max(2, body.radius * scale);
      const known = body.catalogued || body.scanned;
      const visible = known || body.discovered;
      ctx.save();
      ctx.globalAlpha = known ? 0.95 : visible ? 0.38 : 0.16;
      ctx.strokeStyle = known ? body.glow : '#405263';
      ctx.fillStyle = known ? body.glow : '#405263';
      ctx.lineWidth = 1;
      if (body.type === 'station') {
        ctx.strokeRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
        ctx.fillRect(x - r * 0.42, y - r * 0.42, r * 0.84, r * 0.84);
      } else if (body.type === 'comet') {
        ctx.beginPath();
        ctx.moveTo(x + r * 2.2, y);
        ctx.lineTo(x - r * 0.4, y - r * 0.7);
        ctx.lineTo(x - r * 0.4, y + r * 0.7);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.65, 0, TAU);
        ctx.fill();
      }
      if (known && (body.featured || r > 4)) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#dff8ff';
        ctx.font = '9px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(body.name, x, y + r + 13);
      }
      ctx.restore();
    }

    for (const a of world.anomalies) {
      const x = sx(a.x);
      const y = sy(a.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = a.found ? '#8affc1' : '#526b78';
      ctx.fillStyle = a.found ? 'rgba(138,255,193,0.35)' : 'rgba(82,107,120,0.15)';
      ctx.lineWidth = 1.4;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
      ctx.fillStyle = a.found ? '#8affc1' : '#526b78';
      ctx.font = '9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(a.found ? a.name : '?', x, y - 9);
    }

    for (const enemy of combat.enemies) {
      const x = sx(enemy.x);
      const y = sy(enemy.y);
      ctx.strokeStyle = 'rgba(255, 105, 140, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3);
      ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3);
      ctx.stroke();
    }

    if (renderer?.camera) {
      const viewW = renderer.canvas.width / renderer.camera.zoom;
      const viewH = renderer.canvas.height / renderer.camera.zoom;
      ctx.strokeStyle = 'rgba(140,234,255,0.28)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx(renderer.camera.x - viewW / 2), sy(renderer.camera.y - viewH / 2), viewW * scale, viewH * scale);
      ctx.setLineDash([]);
    }

    const px = sx(ship.x);
    const py = sy(ship.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ship.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#8ceaff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + ship.vx * 0.32 * scale, py + ship.vy * 0.32 * scale);
    ctx.stroke();

    const stats = world.catalogStats();
    ctx.fillStyle = '#8ceaff';
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`YEAR ${stats.year} · CATALOG ${stats.catalogued}/${stats.total} · UNCATALOGUED ${stats.uncatalogued}`, 16, 20);
  }

  updateLandingGuide(game) {
    const { ship } = game;
    const m = ship.metrics;
    const show = m && m.altitude < 170 && !this.tradeOpen;
    this.el.landingGuide.classList.toggle('hidden', !show);
    if (!show || !m) return;
    this.setText('guideVs', `${m.vertical >= 0 ? '+' : ''}${m.vertical.toFixed(1)} m/s`);
    this.setText('guideHs', `${m.horizontal.toFixed(1)} m/s`);
    this.setText('guideAlign', percent(Math.max(0, m.align) * 100));
    let verdict = 'LANDING WINDOW';
    let tone = 'good';
    if (ship.eva?.active) {
      verdict = 'EVA TETHER ACTIVE';
    } else if (ship.orbitHold) {
      verdict = 'SLOW ORBIT HOLD';
    } else if (ship.clamped) {
      verdict = 'PAD CLAMP HOLD · L RELEASE';
    } else if (ship.landed) {
      verdict = 'SURFACE HOLD';
    } else if (m.vertical > 6) {
      verdict = 'DESCENT TOO FAST';
      tone = 'bad';
    } else if (m.horizontal > 5) {
      verdict = 'KILL LATERAL DRIFT';
      tone = 'warn';
    } else if (m.align < 0.65) {
      verdict = 'ROTATE LEGS TO SURFACE';
      tone = 'warn';
    } else if (m.vertical > 2.6) {
      verdict = 'REDUCE DESCENT RATE';
      tone = 'warn';
    }
    this.setText('guideVerdict', verdict);
    this.el.guideVerdict.className = `guide-verdict ${tone === 'good' ? '' : tone}`;
  }

  render(dt, game) {
    const { world, ship, combat, renderer, paused, simRate } = game;
    for (const entry of this.logEntries) entry.life -= dt;
    if (this.logEntries.some((e) => e.life <= 0)) {
      this.logEntries = this.logEntries.filter((e) => e.life > 0);
      this.logDirty = true;
    }
    if (this.logDirty && (this.logTimer ?? 0) <= 0) {
      this.renderLog();
      this.logTimer = 0.2;
    }
    this.logTimer = Math.max(0, (this.logTimer ?? 0) - dt);
    this.hintTimer -= dt;
    if (this.hintTimer < 0) this.el.hint.style.opacity = '0';

    this.el.pause.classList.toggle('hidden', !paused);
    this.mapTimer -= dt;
    if (this.mapOpen && this.mapTimer <= 0) {
      this.drawMap(world, ship, combat, renderer, game.time);
      this.mapTimer = 0.12;
    }

    this.updateTimer -= dt;
    if (this.updateTimer > 0) return;
    this.updateTimer = 0.075;

    this.setText('credits', `${Math.floor(ship.credits)}`);
    this.setText('clock', formatTime(game.time));
    this.setText('simRate', `${Math.round(simRate)} Hz`);
    const nav = ship.metrics?.body || world.nearestBody(ship.x, ship.y).body;
    const navKnown = nav?.catalogued || nav?.scanned;
    this.setText('sector', navKnown ? nav.name : 'LUNA ORBIT / UNCATALOGUED');
    const mode = ship.eva?.active ? 'EVA' : ship.orbitHold ? 'ORBIT HOLD' : ship.clamped ? 'PAD CLAMP' :
      ship.landed ? 'SURFACE' : ship.docked?.ready ? 'DOCKED' : ship.laneDrive ? `LANE ${ship.laneDrive > 0 ? 'UP' : 'DOWN'}` :
      ship.scoop ? 'SCOOP' : 'MANUAL';
    this.setText('mode', mode);

    this.setBar('hullBar', 'hullVal', ship.hull, ship.hull < 30);
    this.setBar('fuelBar', 'fuelVal', ship.fuel, ship.fuel < 18);
    this.setBar('energyBar', 'energyVal', ship.energy, ship.energy < 15);
    this.setBar('heatBar', 'heatVal', ship.heat, ship.heat > 80);

    const used = ship.cargoUsed();
    this.setText('cargoUsed', `${used.toFixed(1)} / ${ship.capacity}`);
    const cargoEntries = Object.entries(ship.cargo)
      .filter(([, units]) => units > 0.01)
      .sort((a, b) => b[1] - a[1]);
    this.el.cargoList.innerHTML = cargoEntries.length
      ? cargoEntries.map(([id, units]) => `<span>${escapeHtml(COMMODITIES[id]?.name || id)} <b>${units.toFixed(1)}u</b></span>`).join('')
      : '<span class="dim">ballast only</span>';
    if (this.el.objective) this.el.objective.textContent = game.objectiveText || 'Explore, mine, trade and survive.';

    const m = ship.metrics;
    this.setText('targetName', m?.body?.name || 'DEEP SPACE');
    this.setText('altitude', m ? formatDistance(m.altitude) : '—');
    this.setText('speed', m ? `${m.speed.toFixed(1)} m/s` : '0.0 m/s');
    this.setText('verticalSpeed', m ? `${m.vertical >= 0 ? '+' : ''}${m.vertical.toFixed(1)}` : '0.0');
    this.setText('gravity', m ? `${m.gravity.toFixed(3)}` : '0.000');
    this.setText('alignment', m ? percent(Math.max(0, m.align) * 100) : '—');

    let state = 'NO CONTACT';
    let stateTone = 'dim';
    if (ship.eva?.active) {
      state = `EVA · O₂ ${ship.eva.oxygen.toFixed(0)}% · TETHER ${Math.hypot(ship.x - ship.eva.x, ship.y - ship.eva.y).toFixed(0)} m`;
      stateTone = 'good';
    } else if (ship.orbitHold) {
      state = 'SLOW ORBIT HOLD · G FOR EVA · O TO RELEASE';
      stateTone = 'good';
    } else if (ship.clamped || ship.docked?.clamped) {
      state = `PAD CLAMP · ${ship.docked?.body?.name || ship.padClamp?.body?.name || 'EXCHANGE'} · T TRADE / L RELEASE`;
      stateTone = 'good';
    } else if (ship.docked?.ready) {
      state = `DOCKED · ${ship.docked.body.name} · PRESS T TO TRADE`;
      stateTone = 'good';
    } else if (ship.landed && ship.landedBody) {
      state = `LANDED · ${ship.landedBody.name} · ${ship.lastLanding?.quality?.toFixed(0) || 0}% QUALITY`;
      stateTone = 'good';
    } else if (ship.contact) {
      state = 'SURFACE CONTACT · MANUAL HOLD REQUIRED';
      stateTone = 'warn';
    } else if (m?.altitude < 120 && m.vertical > 7) {
      state = 'HIGH DESCENT RATE';
      stateTone = 'bad';
    } else if (m?.altitude < 220) {
      state = 'APPROACHING MATERIAL FIELD';
      stateTone = '';
    }
    this.setText('landingState', state);
    this.el.landingState.className = `state-line ${stateTone}`;

    this.setText('toolName', ship.tool.toUpperCase());
    this.setText('gearState', ship.gear ? 'DOWN' : 'UP');
    this.setText('scoopState', ship.scoop ? `ON · MAG ${ship.magnetLevel}` : 'OFF');
    this.setText('threatCount', `${combat.threatsNear(ship, 1000)}`);
    const catalog = world.catalogStats();
    this.setText('discovered', `CATALOG ${catalog.catalogued}/${catalog.total} · UNCAT ${catalog.uncatalogued}`);
    this.updateLandingGuide(game);
  }
}
