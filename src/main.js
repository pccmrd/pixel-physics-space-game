import { Game } from './game/game.js';

const canvas = document.getElementById('game');

try {
  window.game = new Game(canvas);
} catch (error) {
  console.error(error);
  const log = document.getElementById('log');
  if (log) {
    log.innerHTML = `<div class="bad">ENGINE INITIALIZATION FAILED: ${String(error.message || error)}</div>`;
  }
}
