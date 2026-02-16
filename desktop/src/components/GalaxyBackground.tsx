import React, { useEffect, useRef } from "react";

interface GalaxyBackgroundProps {
  starCount?: number;
  speed?: number;
  gridSize?: number;
  showGrid?: boolean;
}

const GalaxyBackground: React.FC<GalaxyBackgroundProps> = ({
  starCount = 800,
  speed = 0.5,
  gridSize = 40,
  showGrid = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let width = window.innerWidth;
    let height = window.innerHeight;

    canvas.width = width;
    canvas.height = height;

    // Star particles - black and white only
    class Star {
      x: number;
      y: number;
      z: number;
      layer: number;
      speed: number;
      opacity: number;
      pulse: number;
      pulseSpeed: number;

      constructor(layer = 0) {
        this.layer = layer;
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.z = Math.random() * 1500 + 500;

        const layerMultiplier = 1 + this.layer * 0.5;
        this.speed = (Math.random() * 2 + 1) * speed * layerMultiplier;
        this.opacity = Math.random() * 0.5 + 0.5;
        this.pulse = Math.random() * Math.PI * 2;
        this.pulseSpeed = Math.random() * 0.02 + 0.01;
      }

      reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.z = 1500;
      }

      update() {
        this.z -= this.speed * 10;
        this.pulse += this.pulseSpeed;

        if (this.z <= 0) {
          this.z = 1500;
          this.x = Math.random() * width;
          this.y = Math.random() * height;
        }
      }

      draw() {
        if (!ctx) {
          return;
        }

        const centerX = width / 2;
        const centerY = height / 2;

        const k = 128 / Math.max(this.z, 1);
        const px = (this.x - centerX) * k + centerX;
        const py = (this.y - centerY) * k + centerY;

        if (px < 0 || px > width || py < 0 || py > height) {
          this.reset();
          return;
        }

        const size = Math.max(0.1, (1 - this.z / 1500) * 3 + 0.5);
        const pulseOpacity = Math.max(
          0,
          Math.min(1, this.opacity * (0.7 + 0.3 * Math.sin(this.pulse))),
        );

        ctx.save();
        ctx.globalAlpha = pulseOpacity;

        // White glow
        const glowRadius = Math.max(0.1, size * 4);
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, glowRadius);
        gradient.addColorStop(0, "#ffffff");
        gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.25)");
        gradient.addColorStop(1, "transparent");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // White core
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.1, size * 0.5), 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // White trail for depth layers
        if (this.layer > 0 && size > 0.2) {
          const prevK = 128 / Math.max(this.z + this.speed * 10, 1);
          const prevPx = (this.x - centerX) * prevK + centerX;
          const prevPy = (this.y - centerY) * prevK + centerY;

          ctx.save();
          ctx.globalAlpha = pulseOpacity * 0.3;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(0.1, size * 0.5);
          ctx.beginPath();
          ctx.moveTo(prevPx, prevPy);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Subtle nebula - grayscale only
    class Nebula {
      x: number;
      y: number;
      radius: number;
      opacity: number;
      drift: { x: number; y: number };

      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.radius = Math.random() * 300 + 200;
        this.opacity = Math.random() * 0.02 + 0.005;
        this.drift = {
          x: (Math.random() - 0.5) * 0.1,
          y: (Math.random() - 0.5) * 0.1,
        };
      }

      update() {
        this.x += this.drift.x;
        this.y += this.drift.y;

        if (this.x < -this.radius) {
          this.x = width + this.radius;
        }
        if (this.x > width + this.radius) {
          this.x = -this.radius;
        }
        if (this.y < -this.radius) {
          this.y = height + this.radius;
        }
        if (this.y > height + this.radius) {
          this.y = -this.radius;
        }
      }

      draw() {
        if (!ctx) {
          return;
        }

        const safeRadius = Math.max(1, this.radius);
        const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, safeRadius);

        const opacityHex = Math.floor(Math.max(0, Math.min(1, this.opacity)) * 255)
          .toString(16)
          .padStart(2, "0");
        gradient.addColorStop(0, "#ffffff" + opacityHex);
        gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.02)");
        gradient.addColorStop(1, "transparent");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, safeRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Initialize
    const stars: Star[] = [];
    for (let i = 0; i < starCount; i++) {
      const layer = Math.floor(Math.random() * 3);
      stars.push(new Star(layer));
    }

    const nebulae: Nebula[] = [];
    for (let i = 0; i < 5; i++) {
      nebulae.push(new Nebula());
    }

    let gridOffset = 0;
    let time = 0;

    const animate = () => {
      // Clear with motion blur
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.fillRect(0, 0, width, height);

      time += 0.016;

      // Draw nebulae
      nebulae.forEach((nebula) => {
        nebula.update();
        nebula.draw();
      });

      // Draw grid - white/gray only
      if (showGrid) {
        gridOffset = (gridOffset + speed * 0.5) % gridSize;

        ctx.save();

        // Horizontal lines
        for (let y = gridOffset; y < height; y += gridSize) {
          const distFromCenter = Math.abs(y - height / 2) / (height / 2);
          const opacity = 0.02 + 0.03 * (1 - distFromCenter);

          ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }

        // Vertical lines
        for (let x = 0; x < width; x += gridSize) {
          const distFromCenter = Math.abs(x - width / 2) / (width / 2);
          const opacity = 0.02 + 0.03 * (1 - distFromCenter);

          ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }

        // Scanning line - white
        const scanY = ((time * 50) % (height + 100)) - 50;
        const scanGradient = ctx.createLinearGradient(0, scanY - 50, 0, scanY + 50);
        scanGradient.addColorStop(0, "transparent");
        scanGradient.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
        scanGradient.addColorStop(1, "transparent");

        ctx.fillStyle = scanGradient;
        ctx.fillRect(0, scanY - 50, width, 100);

        ctx.restore();
      }

      // Draw stars
      stars.forEach((star) => {
        star.update();
        star.draw();
      });

      // Central glow - white only
      const orbX = width / 2;
      const orbY = height / 2;
      const orbRadius = Math.max(1, 100 + Math.sin(time * 2) * 20);

      const orbGradient = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, orbRadius);
      orbGradient.addColorStop(0, "rgba(255, 255, 255, 0.08)");
      orbGradient.addColorStop(0.5, "rgba(255, 255, 255, 0.03)");
      orbGradient.addColorStop(1, "transparent");

      ctx.fillStyle = orbGradient;
      ctx.beginPath();
      ctx.arc(orbX, orbY, orbRadius, 0, Math.PI * 2);
      ctx.fill();

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [starCount, speed, gridSize, showGrid]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
};

export default GalaxyBackground;
