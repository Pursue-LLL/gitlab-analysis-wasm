import React, { useEffect, useRef } from 'react';

interface FireworksProps {
  duration?: number;
  onComplete?: () => void;
}

const Fireworks: React.FC<FireworksProps> = ({ duration = 4000, onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasSize = { width: 600, height: 600 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    const particles: any[] = [];

    class Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      alpha: number;
      color: string;

      constructor(x: number, y: number, color: string) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 4 - 2;
        this.vy = Math.random() * 4 - 2;
        this.alpha = 1;
        this.color = color;
      }

      draw() {
        if (!ctx) return;
        ctx.globalAlpha = this.alpha;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.05;
        this.alpha -= 0.02;
      }
    }

    function createFirework() {
      const x = canvasSize.width / 2 + (Math.random() * 100 - 50);
      const y = canvasSize.height / 2 + (Math.random() * 100 - 50);
      const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeead'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      for (let i = 0; i < 30; i++) {
        particles.push(new Particle(x, y, color));
      }
    }

    let startTime = Date.now();
    function animate() {
      if (Date.now() - startTime >= duration) {
        onComplete?.();
        return;
      }

      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

      if (Math.random() < 0.1) {
        createFirework();
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].draw();
        particles[i].update();

        if (particles[i].alpha <= 0) {
          particles.splice(i, 1);
        }
      }

      requestAnimationFrame(animate);
    }

    animate();

    return () => {
      particles.length = 0;
    };
  }, [duration, onComplete]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 9999,
        background: 'transparent',
        width: canvasSize.width,
        height: canvasSize.height,
      }}
    />
  );
};

export default Fireworks; 