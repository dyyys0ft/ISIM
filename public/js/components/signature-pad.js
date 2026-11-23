/**
 * Pad de firma responsive basado en Canvas + Pointer Events.
 * Guarda los trazos normalizados (0..1) para que la firma sobreviva a rotaciones
 * y cambios de tamaño de la ventana. Exporta un PNG recortado al área dibujada.
 */
export class SignaturePad {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.current = null;
    this.width = 0;
    this.height = 0;
    this.ratio = 1;
    this.enabled = true;
    this.onChange = onChange || (() => {});
    this.frame = null;

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    this._resize = this._resize.bind(this);

    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerup', this._up);
    canvas.addEventListener('pointercancel', this._up);
    canvas.addEventListener('lostpointercapture', this._up);

    if ('ResizeObserver' in window) {
      this.observer = new ResizeObserver(this._resize);
      this.observer.observe(canvas);
    }
    window.addEventListener('resize', this._resize);

    this._resize();
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    this.canvas.style.cursor = this.enabled ? 'crosshair' : 'default';
    if (!this.enabled) this._up();
  }

  clear() {
    this.strokes = [];
    this.current = null;
    this.render();
    this.onChange();
  }

  undo() {
    this.strokes.pop();
    this.render();
    this.onChange();
  }

  isEmpty() {
    return !this.strokes.some((stroke) => stroke.points.length > 1);
  }

  _point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  _down(event) {
    if (!this.enabled || !event.isPrimary || event.button > 0) return;
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // algunos navegadores no permiten capturar el puntero
    }
    this.current = { points: [this._point(event)] };
    this.strokes.push(this.current);
    this._schedule();
    this.onChange();
  }

  _move(event) {
    if (!this.enabled || !this.current || !event.isPrimary) return;
    event.preventDefault();

    const point = this._point(event);
    const previous = this.current.points[this.current.points.length - 1];
    const dx = (point.x - previous.x) * this.width;
    const dy = (point.y - previous.y) * this.height;
    if (dx * dx + dy * dy < 1.4) return;

    this.current.points.push(point);
    this._schedule();
  }

  _up() {
    if (!this.current) return;
    this.current = null;
    this.render();
    this.onChange();
  }

  _schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = rect.width;
    this.height = rect.height;
    this.ratio = dpr;

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.render();
  }

  _drawStroke(ctx, stroke, width, height) {
    const points = stroke.points;
    if (!points.length) return;

    ctx.strokeStyle = '#16202b';
    ctx.fillStyle = '#16202b';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.8;

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x * width, points[0].y * height, 1.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x * width, points[0].y * height);

    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index];
      const next = points[index + 1];
      const midX = ((point.x + next.x) / 2) * width;
      const midY = ((point.y + next.y) / 2) * height;
      ctx.quadraticCurveTo(point.x * width, point.y * height, midX, midY);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x * width, last.y * height);
    ctx.stroke();
  }

  render() {
    const { ctx, width, height, ratio } = this;
    if (!width || !height) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    for (const stroke of this.strokes) {
      this._drawStroke(ctx, stroke, width, height);
    }
  }

  _bounds() {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;

    for (const stroke of this.strokes) {
      for (const point of stroke.points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }

    return { minX, minY, maxX, maxY };
  }

  toDataURL() {
    if (this.isEmpty()) return null;

    const bounds = this._bounds();
    const padding = 14;
    const x = Math.max(0, bounds.minX * this.width - padding);
    const y = Math.max(0, bounds.minY * this.height - padding);
    const width = Math.min(
      this.width - x,
      (bounds.maxX - bounds.minX) * this.width + padding * 2
    );
    const height = Math.min(
      this.height - y,
      (bounds.maxY - bounds.minY) * this.height + padding * 2
    );

    const scale = 2;
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(width * scale));
    output.height = Math.max(1, Math.round(height * scale));

    const ctx = output.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    for (const stroke of this.strokes) {
      this._drawStroke(ctx, stroke, this.width, this.height);
    }

    return output.toDataURL('image/png');
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
    this.observer?.disconnect();
    this.canvas.removeEventListener('pointerdown', this._down);
    this.canvas.removeEventListener('pointermove', this._move);
    this.canvas.removeEventListener('pointerup', this._up);
    this.canvas.removeEventListener('pointercancel', this._up);
    this.canvas.removeEventListener('lostpointercapture', this._up);
  }
}
