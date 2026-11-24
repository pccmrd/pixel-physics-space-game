const PREVENT_DEFAULT = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'
]);

export class Input {
  constructor(canvas, onFirstInteraction = () => {}) {
    this.canvas = canvas;
    this.onFirstInteraction = onFirstInteraction;
    this.pressed = new Set();
    this.justPressed = new Set();
    this.wheelDelta = 0;
    this.interacted = false;
    this.pointer = {
      x: canvas.width / 2,
      y: canvas.height / 2,
      inside: false,
      movedAt: 0,
      left: false,
      right: false
    };
    this.bind();
  }

  firstInteraction() {
    if (this.interacted) return;
    this.interacted = true;
    this.onFirstInteraction();
  }

  bind() {
    window.addEventListener('keydown', (event) => {
      this.firstInteraction();
      if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
      if (!event.repeat) this.justPressed.add(event.code);
      this.pressed.add(event.code);
    }, { passive: false });

    window.addEventListener('keyup', (event) => {
      this.pressed.delete(event.code);
    });

    const updatePointer = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = (event.clientX - rect.left) / rect.width * this.canvas.width;
      this.pointer.y = (event.clientY - rect.top) / rect.height * this.canvas.height;
      this.pointer.inside = true;
      this.pointer.movedAt = performance.now();
    };

    this.canvas.addEventListener('pointermove', updatePointer);
    this.canvas.addEventListener('pointerenter', updatePointer);
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.inside = false;
      this.pointer.left = false;
      this.pointer.right = false;
      this.pressed.delete('Mouse0');
      this.pressed.delete('Mouse2');
    });

    this.canvas.addEventListener('pointerdown', (event) => {
      this.firstInteraction();
      updatePointer(event);
      event.preventDefault();
      const code = event.button === 0 ? 'Mouse0' : event.button === 2 ? 'Mouse2' : `Mouse${event.button}`;
      if (!this.pressed.has(code)) this.justPressed.add(code);
      this.pressed.add(code);
      if (event.button === 0) this.pointer.left = true;
      if (event.button === 2) this.pointer.right = true;
    });

    window.addEventListener('pointerup', (event) => {
      const code = event.button === 0 ? 'Mouse0' : event.button === 2 ? 'Mouse2' : `Mouse${event.button}`;
      this.pressed.delete(code);
      if (event.button === 0) this.pointer.left = false;
      if (event.button === 2) this.pointer.right = false;
    });

    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('wheel', (event) => {
      this.firstInteraction();
      event.preventDefault();
      this.wheelDelta += -event.deltaY * 0.0016;
    }, { passive: false });

    window.addEventListener('blur', () => {
      this.pressed.clear();
      this.justPressed.clear();
      this.pointer.left = false;
      this.pointer.right = false;
    });
  }

  isDown(code) {
    return this.pressed.has(code);
  }

  anyDown(...codes) {
    return codes.some((code) => this.pressed.has(code));
  }

  consumePress(...codes) {
    for (const code of codes) {
      if (this.justPressed.has(code)) {
        this.justPressed.delete(code);
        return true;
      }
    }
    return false;
  }

  takeWheel() {
    const value = this.wheelDelta;
    this.wheelDelta = 0;
    return value;
  }

  endFrame() {
    this.justPressed.clear();
    this.wheelDelta = 0;
  }
}
