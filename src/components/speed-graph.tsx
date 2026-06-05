'use client';

import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useAppStore } from '@/lib/store';

export function SpeedGraph() {
  const { clips, selectedClipId, rampMinSpeed, rampMaxSpeed } = useAppStore();
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [manualPlayheadPos, setManualPlayheadPos] = useState<number | null>(null);

  // Derive animation state from clip status (no setState in effect)
  const isAnimating = useMemo(
    () => selectedClip?.status === 'completed',
    [selectedClip?.status]
  );

  // Dynamic speed values from store
  const fwdStartSpeed = rampMaxSpeed;
  const fwdEndSpeed = rampMinSpeed;
  const revStartSpeed = rampMinSpeed;
  const revEndSpeed = rampMaxSpeed;
  // Dynamic scale: use max speed + some padding
  const scaleMax = Math.max(rampMaxSpeed + 0.5, 4.5);

  const drawGraph = useCallback((timestamp?: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedClip) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 30, right: 55, bottom: 45, left: 55 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    // Animation time
    const t = (timestamp || 0) / 1000;
    timeRef.current = t;

    // Background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    // Subtle inner glow at top — dual color
    const topGlow = ctx.createLinearGradient(0, 0, graphWidth, 0);
    topGlow.addColorStop(0, 'rgba(249, 115, 22, 0.04)');
    topGlow.addColorStop(0.5, 'rgba(168, 85, 247, 0.02)');
    topGlow.addColorStop(1, 'rgba(6, 182, 212, 0.04)');
    ctx.fillStyle = topGlow;
    ctx.fillRect(padding.left, padding.top, graphWidth, 40);

    // Graph border with rounded corners
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(padding.left, padding.top, graphWidth, graphHeight, 4);
    ctx.stroke();

    // Grid - horizontal dashed lines at each speed value
    const maxGridSpeed = Math.floor(scaleMax);
    const speedValues = Array.from({ length: maxGridSpeed + 1 }, (_, i) => i);
    speedValues.forEach(speed => {
      const y = padding.top + graphHeight - (speed / scaleMax) * graphHeight;

      // Calculate distance from mouse for glow effect
      let glowIntensity = 0;
      if (mousePos) {
        const gridMidX = width / 2;
        const dist = Math.abs(mousePos.x - gridMidX);
        const maxDist = width / 2;
        glowIntensity = Math.max(0, 1 - dist / maxDist) * 0.3;
      }

      const baseAlpha = 0.15;
      const alpha = baseAlpha + glowIntensity;
      const r = Math.round(63 + glowIntensity * 200);
      const g = Math.round(63 + glowIntensity * 80);
      const b = Math.round(31 + glowIntensity * 80);

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.lineWidth = 0.5 + glowIntensity * 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Y-axis speed value labels
      ctx.fillStyle = speed === 1 ? '#a1a1aa' : '#52525b';
      ctx.font = speed === 1 ? 'bold 10px ui-monospace, monospace' : '9px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${speed}x`, padding.left - 10, y + 3);
    });

    // Vertical grid with glow effect
    const verticalGridCount = 8;
    for (let i = 0; i <= verticalGridCount; i++) {
      const x = padding.left + (i / verticalGridCount) * graphWidth;

      let glowIntensity = 0;
      if (mousePos) {
        const dist = Math.abs(mousePos.x - x);
        glowIntensity = Math.max(0, 1 - dist / 100) * 0.3;
      }

      const baseAlpha = 0.1;
      const alpha = baseAlpha + glowIntensity;

      ctx.strokeStyle = `rgba(63, 63, 70, ${alpha})`;
      ctx.lineWidth = 0.5 + glowIntensity * 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 1x speed reference line (animated dashed, more prominent)
    const oneX_y = padding.top + graphHeight - (1 / scaleMax) * graphHeight;
    ctx.strokeStyle = '#52525b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -t * 8; // Animated dash flow
    ctx.beginPath();
    ctx.moveTo(padding.left, oneX_y);
    ctx.lineTo(width - padding.right, oneX_y);
    ctx.stroke();
    ctx.setLineDash([]);

    // "Normal speed" label
    ctx.fillStyle = '#71717a';
    ctx.font = '8px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('1x normal', width - padding.right + 6, oneX_y + 3);

    // The total graph is split into two halves:
    const forwardGraphWidth = graphWidth / 2;
    const reverseGraphWidth = graphWidth / 2;

    // Divider line (animated dashed)
    const dividerX = padding.left + forwardGraphWidth;
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = -t * 6; // Animated dash flow
    ctx.beginPath();
    ctx.moveTo(dividerX, padding.top);
    ctx.lineTo(dividerX, height - padding.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Section labels at top
    ctx.fillStyle = '#f97316';
    ctx.font = 'bold 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FORWARD', padding.left + forwardGraphWidth / 2, padding.top - 14);

    ctx.fillStyle = '#22d3ee';
    ctx.fillText('REVERSE', dividerX + reverseGraphWidth / 2, padding.top - 14);

    // Sub-labels
    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = '#a16207';
    ctx.fillText(`${rampMaxSpeed}x → ${rampMinSpeed}x`, padding.left + forwardGraphWidth / 2, padding.top - 4);

    ctx.fillStyle = '#0e7490';
    ctx.fillText(`${rampMinSpeed}x → ${rampMaxSpeed}x`, dividerX + reverseGraphWidth / 2, padding.top - 4);

    // ============= Forward Curve (maxSpeed → minSpeed) =============
    // Animated gradient offset for fill
    const gradientOffset = (t * 0.05) % 1;

    // Vibrant fill gradient under forward curve with animated shift
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const prog = i / 100;
      const speed = fwdStartSpeed + (fwdEndSpeed - fwdStartSpeed) * prog;
      const x = padding.left + prog * forwardGraphWidth;
      const y = padding.top + graphHeight - (speed / scaleMax) * graphHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(padding.left + forwardGraphWidth, height - padding.bottom);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.closePath();

    const forwardGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    // Animated gradient: shift stop positions slightly over time
    const fwdStops = [
      { pos: 0, color: `rgba(249, 115, 22, ${0.35 + Math.sin(t * 0.5) * 0.1})` },
      { pos: 0.15 + gradientOffset * 0.1, color: 'rgba(249, 115, 22, 0.25)' },
      { pos: 0.3, color: 'rgba(249, 115, 22, 0.15)' },
      { pos: 0.6, color: 'rgba(249, 115, 22, 0.08)' },
      { pos: 1, color: 'rgba(249, 115, 22, 0.02)' },
    ];
    fwdStops.forEach(stop => {
      forwardGradient.addColorStop(Math.min(1, Math.max(0, stop.pos)), stop.color);
    });
    ctx.fillStyle = forwardGradient;
    ctx.fill();

    // Glow effect on forward curve (drawn first, underneath the line)
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const prog = i / 100;
      const speed = fwdStartSpeed + (fwdEndSpeed - fwdStartSpeed) * prog;
      const x = padding.left + prog * forwardGraphWidth;
      const y = padding.top + graphHeight - (speed / scaleMax) * graphHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.25)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Draw forward curve line (thicker: strokeWidth 3)
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const prog = i / 100;
      const speed = fwdStartSpeed + (fwdEndSpeed - fwdStartSpeed) * prog;
      const x = padding.left + prog * forwardGraphWidth;
      const y = padding.top + graphHeight - (speed / scaleMax) * graphHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 3;
    ctx.stroke();

    // ============= Reverse Curve (minSpeed → maxSpeed) =============

    // Vibrant fill gradient under reverse curve with animated shift
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const prog = i / 100;
      const speed = revStartSpeed + (revEndSpeed - revStartSpeed) * prog;
      const x = dividerX + prog * reverseGraphWidth;
      const y = padding.top + graphHeight - (speed / scaleMax) * graphHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(dividerX + reverseGraphWidth, height - padding.bottom);
    ctx.lineTo(dividerX, height - padding.bottom);
    ctx.closePath();

    const reverseGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    const revStops = [
      { pos: 0, color: `rgba(6, 182, 212, ${0.35 + Math.sin(t * 0.5 + 1) * 0.1})` },
      { pos: 0.15 + gradientOffset * 0.1, color: 'rgba(6, 182, 212, 0.25)' },
      { pos: 0.3, color: 'rgba(6, 182, 212, 0.15)' },
      { pos: 0.6, color: 'rgba(6, 182, 212, 0.08)' },
      { pos: 1, color: 'rgba(6, 182, 212, 0.02)' },
    ];
    revStops.forEach(stop => {
      reverseGradient.addColorStop(Math.min(1, Math.max(0, stop.pos)), stop.color);
    });
    ctx.fillStyle = reverseGradient;
    ctx.fill();

    // Glow effect on reverse curve
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const prog = i / 100;
      const speed = revStartSpeed + (revEndSpeed - revStartSpeed) * prog;
      const x = dividerX + prog * reverseGraphWidth;
      const y = padding.top + graphHeight - (speed / scaleMax) * graphHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Draw reverse curve line (thicker: strokeWidth 3)
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const prog = i / 100;
      const speed = revStartSpeed + (revEndSpeed - revStartSpeed) * prog;
      const x = dividerX + prog * reverseGraphWidth;
      const y = padding.top + graphHeight - (speed / scaleMax) * graphHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.stroke();

    // ============= Pulsing Glow Endpoints =============
    const pulseScale = 1 + Math.sin(t * 3) * 0.4;
    const pulseAlpha = 0.3 + Math.sin(t * 3) * 0.2;

    // Forward start marker (maxSpeed) — orange pulsing glow
    const fwdStartY = padding.top + graphHeight - (fwdStartSpeed / scaleMax) * graphHeight;
    const fwdStartGlow = ctx.createRadialGradient(
      padding.left, fwdStartY, 0,
      padding.left, fwdStartY, 14 * pulseScale
    );
    fwdStartGlow.addColorStop(0, `rgba(249, 115, 22, ${pulseAlpha})`);
    fwdStartGlow.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = fwdStartGlow;
    ctx.beginPath();
    ctx.arc(padding.left, fwdStartY, 14 * pulseScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(padding.left, fwdStartY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fb923c';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${rampMaxSpeed}x`, padding.left + 10, fwdStartY - 6);

    // Forward end marker (minSpeed) — orange pulsing glow
    const fwdEndY = padding.top + graphHeight - (fwdEndSpeed / scaleMax) * graphHeight;
    const fwdEndGlow = ctx.createRadialGradient(
      padding.left + forwardGraphWidth, fwdEndY, 0,
      padding.left + forwardGraphWidth, fwdEndY, 14 * pulseScale
    );
    fwdEndGlow.addColorStop(0, `rgba(249, 115, 22, ${pulseAlpha})`);
    fwdEndGlow.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = fwdEndGlow;
    ctx.beginPath();
    ctx.arc(padding.left + forwardGraphWidth, fwdEndY, 14 * pulseScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(padding.left + forwardGraphWidth, fwdEndY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fb923c';
    ctx.textAlign = 'right';
    ctx.fillText(`${rampMinSpeed}x`, padding.left + forwardGraphWidth - 10, fwdEndY + 14);

    // Reverse start marker (minSpeed) — cyan pulsing glow
    const revStartY = padding.top + graphHeight - (revStartSpeed / scaleMax) * graphHeight;
    const revStartGlow = ctx.createRadialGradient(
      dividerX, revStartY, 0,
      dividerX, revStartY, 14 * pulseScale
    );
    revStartGlow.addColorStop(0, `rgba(6, 182, 212, ${pulseAlpha})`);
    revStartGlow.addColorStop(1, 'rgba(6, 182, 212, 0)');
    ctx.fillStyle = revStartGlow;
    ctx.beginPath();
    ctx.arc(dividerX, revStartY, 14 * pulseScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dividerX, revStartY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#22d3ee';
    ctx.fill();
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#67e8f9';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${rampMinSpeed}x`, dividerX + 10, revStartY + 14);

    // Reverse end marker (maxSpeed) — cyan pulsing glow
    const revEndY = padding.top + graphHeight - (revEndSpeed / scaleMax) * graphHeight;
    const revEndGlow = ctx.createRadialGradient(
      dividerX + reverseGraphWidth, revEndY, 0,
      dividerX + reverseGraphWidth, revEndY, 14 * pulseScale
    );
    revEndGlow.addColorStop(0, `rgba(6, 182, 212, ${pulseAlpha})`);
    revEndGlow.addColorStop(1, 'rgba(6, 182, 212, 0)');
    ctx.fillStyle = revEndGlow;
    ctx.beginPath();
    ctx.arc(dividerX + reverseGraphWidth, revEndY, 14 * pulseScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dividerX + reverseGraphWidth, revEndY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#22d3ee';
    ctx.fill();
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#67e8f9';
    ctx.textAlign = 'right';
    ctx.fillText(`${rampMaxSpeed}x`, dividerX + reverseGraphWidth - 10, revEndY - 6);

    // Connecting arrow between halves
    ctx.strokeStyle = '#71717a';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.lineDashOffset = -t * 4;
    ctx.beginPath();
    ctx.moveTo(padding.left + forwardGraphWidth - 3, fwdEndY);
    ctx.lineTo(dividerX + 3, revStartY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ============= Animated Playhead =============
    let playheadProgress: number;

    if (isDraggingPlayhead && manualPlayheadPos !== null) {
      // Use manual playhead position when dragging
      playheadProgress = manualPlayheadPos;
    } else if (isAnimating) {
      // Auto-sweep playhead for completed clips
      const cycleDuration = 3;
      playheadProgress = ((t % cycleDuration) / cycleDuration);
    } else {
      playheadProgress = -1;
    }

    if (playheadProgress >= 0 && playheadProgress <= 1) {
      const playheadX = padding.left + playheadProgress * graphWidth;

      // Playhead glow
      const playheadGlow = ctx.createLinearGradient(playheadX - 20, 0, playheadX + 20, 0);
      const playheadColor = playheadProgress < 0.5
        ? { r: 249, g: 115, b: 22 }
        : { r: 6, g: 182, b: 212 };
      playheadGlow.addColorStop(0, `rgba(${playheadColor.r}, ${playheadColor.g}, ${playheadColor.b}, 0)`);
      playheadGlow.addColorStop(0.5, `rgba(${playheadColor.r}, ${playheadColor.g}, ${playheadColor.b}, 0.12)`);
      playheadGlow.addColorStop(1, `rgba(${playheadColor.r}, ${playheadColor.g}, ${playheadColor.b}, 0)`);
      ctx.fillStyle = playheadGlow;
      ctx.fillRect(playheadX - 20, padding.top, 40, graphHeight);

      // Playhead line (dashed for draggable, solid for auto)
      ctx.strokeStyle = playheadProgress < 0.5
        ? 'rgba(249, 115, 22, 0.7)'
        : 'rgba(6, 182, 212, 0.7)';
      ctx.lineWidth = 1.5;
      if (isDraggingPlayhead) {
        ctx.setLineDash([6, 3]);
      }
      ctx.beginPath();
      ctx.moveTo(playheadX, padding.top);
      ctx.lineTo(playheadX, height - padding.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Playhead dot at current speed
      let currentSpeed: number;
      if (playheadProgress < 0.5) {
        const localT = playheadProgress * 2;
        currentSpeed = fwdStartSpeed + (fwdEndSpeed - fwdStartSpeed) * localT;
      } else {
        const localT = (playheadProgress - 0.5) * 2;
        currentSpeed = revStartSpeed + (revEndSpeed - revStartSpeed) * localT;
      }
      const playheadDotY = padding.top + graphHeight - (currentSpeed / scaleMax) * graphHeight;
      ctx.beginPath();
      ctx.arc(playheadX, playheadDotY, isDraggingPlayhead ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = playheadProgress < 0.5 ? '#f97316' : '#22d3ee';
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Speed tooltip at playhead dot
      if (isDraggingPlayhead || isAnimating) {
        const tooltipText = `${currentSpeed.toFixed(1)}x`;
        ctx.font = 'bold 10px ui-monospace, monospace';
        const textWidth = ctx.measureText(tooltipText).width;
        const tooltipX = playheadX + 12;
        const tooltipY = playheadDotY - 12;

        // Tooltip background
        ctx.fillStyle = 'rgba(24, 24, 27, 0.9)';
        ctx.beginPath();
        ctx.roundRect(tooltipX - 4, tooltipY - 8, textWidth + 8, 16, 4);
        ctx.fill();
        ctx.strokeStyle = playheadProgress < 0.5 ? 'rgba(249, 115, 22, 0.5)' : 'rgba(6, 182, 212, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Tooltip text
        ctx.fillStyle = playheadProgress < 0.5 ? '#fb923c' : '#67e8f9';
        ctx.textAlign = 'left';
        ctx.fillText(tooltipText, tooltipX, tooltipY + 3);
      }
    }

    // ============= Tooltip on hover =============
    if (mousePos && !isDraggingPlayhead) {
      const mx = mousePos.x;
      const my = mousePos.y;

      // Only show tooltip within graph area
      if (
        mx >= padding.left && mx <= width - padding.right &&
        my >= padding.top && my <= height - padding.bottom
      ) {
        const hoverProgress = (mx - padding.left) / graphWidth;
        let hoverSpeed: number;

        if (hoverProgress < 0.5) {
          const localT = hoverProgress * 2;
          hoverSpeed = fwdStartSpeed + (fwdEndSpeed - fwdStartSpeed) * localT;
        } else {
          const localT = (hoverProgress - 0.5) * 2;
          hoverSpeed = revStartSpeed + (revEndSpeed - revStartSpeed) * localT;
        }

        const hoverSpeedY = padding.top + graphHeight - (hoverSpeed / scaleMax) * graphHeight;
        const isForward = hoverProgress < 0.5;
        const color = isForward ? '#f97316' : '#22d3ee';
        const colorAlpha = isForward ? 'rgba(249, 115, 22, 0.4)' : 'rgba(6, 182, 212, 0.4)';

        // Crosshair at hover point
        ctx.strokeStyle = colorAlpha;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(mx, padding.top);
        ctx.lineTo(mx, height - padding.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(padding.left, hoverSpeedY);
        ctx.lineTo(width - padding.right, hoverSpeedY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dot on curve
        ctx.beginPath();
        ctx.arc(mx, hoverSpeedY, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#09090b';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Tooltip
        const tooltipText = `${hoverSpeed.toFixed(2)}x`;
        ctx.font = 'bold 10px ui-monospace, monospace';
        const textWidth = ctx.measureText(tooltipText).width;
        const tooltipX = mx + 14;
        const tooltipY = hoverSpeedY - 14;

        ctx.fillStyle = 'rgba(24, 24, 27, 0.92)';
        ctx.beginPath();
        ctx.roundRect(tooltipX - 4, tooltipY - 8, textWidth + 8, 16, 4);
        ctx.fill();
        ctx.strokeStyle = isForward ? 'rgba(249, 115, 22, 0.6)' : 'rgba(6, 182, 212, 0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isForward ? '#fb923c' : '#67e8f9';
        ctx.textAlign = 'left';
        ctx.fillText(tooltipText, tooltipX, tooltipY + 3);
      }
    }

    // ============= Gradient fade at edges =============
    const leftFade = ctx.createLinearGradient(padding.left, 0, padding.left + 30, 0);
    leftFade.addColorStop(0, '#09090b');
    leftFade.addColorStop(1, 'rgba(9, 9, 11, 0)');
    ctx.fillStyle = leftFade;
    ctx.fillRect(padding.left, padding.top, 30, graphHeight);

    const rightFade = ctx.createLinearGradient(width - padding.right - 30, 0, width - padding.right, 0);
    rightFade.addColorStop(0, 'rgba(9, 9, 11, 0)');
    rightFade.addColorStop(1, '#09090b');
    ctx.fillStyle = rightFade;
    ctx.fillRect(width - padding.right - 30, padding.top, 30, graphHeight);

    // ============= X-axis time labels (percentage) =============
    ctx.fillStyle = '#52525b';
    ctx.font = '8px ui-monospace, monospace';
    ctx.textAlign = 'center';

    // Forward timeline with % labels
    ctx.fillText('0%', padding.left, height - padding.bottom + 14);
    ctx.fillText('25%', padding.left + forwardGraphWidth * 0.25, height - padding.bottom + 14);
    ctx.fillText('50%', padding.left + forwardGraphWidth * 0.5, height - padding.bottom + 14);
    ctx.fillText('75%', padding.left + forwardGraphWidth * 0.75, height - padding.bottom + 14);
    ctx.fillText('100%', padding.left + forwardGraphWidth, height - padding.bottom + 14);

    // Reverse timeline with % labels
    ctx.fillText('0%', dividerX, height - padding.bottom + 14);
    ctx.fillText('25%', dividerX + reverseGraphWidth * 0.25, height - padding.bottom + 14);
    ctx.fillText('50%', dividerX + reverseGraphWidth * 0.5, height - padding.bottom + 14);
    ctx.fillText('75%', dividerX + reverseGraphWidth * 0.75, height - padding.bottom + 14);
    ctx.fillText('100%', dividerX + reverseGraphWidth, height - padding.bottom + 14);

    // Duration in seconds at bottom
    ctx.fillStyle = '#3f3f46';
    ctx.font = '7px ui-monospace, monospace';
    ctx.fillText(`(${selectedClip.duration.toFixed(1)}s)`, padding.left + forwardGraphWidth / 2, height - padding.bottom + 26);
    ctx.fillText(`(${selectedClip.duration.toFixed(1)}s)`, dividerX + reverseGraphWidth / 2, height - padding.bottom + 26);

    // Bottom axis label
    ctx.fillStyle = '#52525b';
    ctx.font = '8px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Clip Duration →', width / 2, height - 5);

    // Left axis label (rotated)
    ctx.save();
    ctx.translate(10, padding.top + graphHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#52525b';
    ctx.font = '8px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Speed', 0, 0);
    ctx.restore();

  }, [selectedClip, isAnimating, fwdStartSpeed, fwdEndSpeed, revStartSpeed, revEndSpeed, scaleMax, rampMinSpeed, rampMaxSpeed, mousePos, isDraggingPlayhead, manualPlayheadPos]);

  // Animation loop
  useEffect(() => {
    let running = true;

    const animate = (timestamp: number) => {
      if (!running) return;
      drawGraph(timestamp);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    if (isAnimating || isDraggingPlayhead) {
      animFrameRef.current = requestAnimationFrame(animate);
    } else {
      drawGraph(0);
    }

    return () => {
      running = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [drawGraph, isAnimating, isDraggingPlayhead]);

  // Resize observer
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => drawGraph(timeRef.current * 1000));
    if (canvasRef.current?.parentElement) {
      resizeObserver.observe(canvasRef.current.parentElement);
    }
    return () => resizeObserver.disconnect();
  }, [drawGraph]);

  // Mouse move handler for tooltip + playhead drag
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setMousePos({ x, y });

      // If dragging playhead, update position
      if (isDraggingPlayhead) {
        const padding = { left: 55, right: 55 };
        const graphWidth = rect.width - padding.left - padding.right;
        const progress = Math.max(0, Math.min(1, (x - padding.left) / graphWidth));
        setManualPlayheadPos(progress);
      }
    }
  }, [isDraggingPlayhead]);

  const handleMouseLeave = useCallback(() => {
    setMousePos(null);
    if (isDraggingPlayhead) {
      setIsDraggingPlayhead(false);
      setManualPlayheadPos(null);
    }
  }, [isDraggingPlayhead]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedClip || selectedClip.status !== 'completed') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const padding = { left: 55, right: 55 };
    const graphWidth = rect.width - padding.left - padding.right;
    const progress = (x - padding.left) / graphWidth;

    if (progress >= 0 && progress <= 1) {
      setIsDraggingPlayhead(true);
      setManualPlayheadPos(progress);
    }
  }, [selectedClip]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingPlayhead) {
      setIsDraggingPlayhead(false);
      // Keep manual position for a moment before releasing
      setTimeout(() => setManualPlayheadPos(null), 2000);
    }
  }, [isDraggingPlayhead]);

  if (!selectedClip) {
    return (
      <Card className="bg-zinc-900/50 border-zinc-800 p-4">
        <p className="text-zinc-500 text-sm text-center">Select a clip to view the speed graph</p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Speed Graph</h3>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-[3px] bg-orange-500 inline-block rounded" />
            Forward ({rampMaxSpeed}x → {rampMinSpeed}x)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-[3px] bg-cyan-400 inline-block rounded" />
            Reverse ({rampMinSpeed}x → {rampMaxSpeed}x)
          </span>
        </div>
      </div>
      <Card className="bg-zinc-950 border-zinc-800 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair"
          style={{ height: '240px' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
      </Card>
      {/* Info Panel — 2-column grid layout with colored line segments */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 py-1.5 px-3 bg-zinc-900/60 rounded-lg border border-zinc-800/50">
          <svg width="16" height="8" className="flex-shrink-0">
            <line x1="0" y1="4" x2="16" y2="4" stroke="#f97316" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="text-[11px] text-zinc-400">
            Forward: <span className="text-orange-400 font-medium">{rampMaxSpeed}x</span>
            <span className="text-zinc-600 mx-1">→</span>
            <span className="text-orange-300 font-medium">{rampMinSpeed}x</span>
          </span>
        </div>
        <div className="flex items-center gap-2 py-1.5 px-3 bg-zinc-900/60 rounded-lg border border-zinc-800/50">
          <svg width="16" height="8" className="flex-shrink-0">
            <line x1="0" y1="4" x2="16" y2="4" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="text-[11px] text-zinc-400">
            Reverse: <span className="text-cyan-400 font-medium">{rampMinSpeed}x</span>
            <span className="text-zinc-600 mx-1">→</span>
            <span className="text-cyan-300 font-medium">{rampMaxSpeed}x</span>
          </span>
        </div>
        {isAnimating && (
          <div className="col-span-2 flex items-center justify-center py-1 px-3 bg-green-500/5 rounded-lg border border-green-500/10">
            <span className="text-[10px] text-green-400/80 animate-pulse">● Playing — click & drag to scrub</span>
          </div>
        )}
      </div>
    </div>
  );
}
