import { useEffect, useRef, useState } from 'react';
import { chapterRippleShader } from '../core/chapter-ripple';

/** One shared shader keeps the authoring preview and exported game in sync. */
export function ChapterRipple({ source, seconds, strength, speed, fit = 'cover', fitBeforeRipple = false, alignY = .5 }: { source: string; seconds: number; strength: number; speed: number; fit?: 'cover' | 'contain' | 'stretch'; fitBeforeRipple?: boolean; alignY?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null), draw = useRef<(() => void) | undefined>(undefined);
  const values = useRef({ seconds, strength, speed }); values.current = { seconds, strength, speed };
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    setReady(false);
    const gl = surface.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) return;
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return undefined; }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 a_position; varying vec2 v_uv; void main() { v_uv = vec2(a_position.x * .5 + .5, .5 - a_position.y * .5); gl_Position = vec4(a_position, 0.0, 1.0); }');
    const fragment = compile(gl.FRAGMENT_SHADER, `precision highp float; varying vec2 v_uv; uniform sampler2D u_image; uniform vec2 u_fit; uniform float u_time, u_strength, u_speed; ${chapterRippleShader} void main() { vec2 uv = (vn_ripple_uv(v_uv, u_time, u_strength, u_speed) - .5) * u_fit + .5; gl_FragColor = texture2D(u_image, uv); }`);
    if (!vertex || !fragment) { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); return; }
    const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const uniforms = Object.fromEntries(['u_fit', 'u_time', 'u_strength', 'u_speed'].map(name => [name, gl.getUniformLocation(program, name)]));
    let active = true, loaded = false;
    const image = new Image(); image.crossOrigin = 'anonymous';
    let textureWidth = 0, textureHeight = 0;
    let width = Math.max(1, Math.round(surface.clientWidth * devicePixelRatio));
    let height = Math.max(1, Math.round(surface.clientHeight * devicePixelRatio));
    const render = () => {
      if (!active || !loaded || gl.isContextLost()) return;
      if (surface.width !== width || surface.height !== height) { surface.width = width; surface.height = height; }
      gl.viewport(0, 0, width, height);
      if (fitBeforeRipple && (textureWidth !== width || textureHeight !== height)) {
        const fitted = document.createElement('canvas'); fitted.width = width; fitted.height = height;
        const ctx = fitted.getContext('2d')!;
        const factor = (fit === 'contain' ? Math.min : Math.max)(width / image.naturalWidth, height / image.naturalHeight);
        const iw = fit === 'stretch' ? width : image.naturalWidth * factor, ih = fit === 'stretch' ? height : image.naturalHeight * factor;
        ctx.drawImage(image, (width - iw) / 2, (height - ih) * alignY, iw, ih);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fitted);
        textureWidth = width; textureHeight = height;
      }
      const cover = (fit === 'contain' ? Math.min : Math.max)(width / image.naturalWidth, height / image.naturalHeight);
      gl.uniform2f(uniforms.u_fit, fitBeforeRipple || fit === 'stretch' ? 1 : width / (image.naturalWidth * cover), fitBeforeRipple || fit === 'stretch' ? 1 : height / (image.naturalHeight * cover));
      gl.uniform1f(uniforms.u_time, values.current.seconds); gl.uniform1f(uniforms.u_strength, values.current.strength); gl.uniform1f(uniforms.u_speed, values.current.speed);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    image.onload = () => {
      if (!active) return;
      try { if (!fitBeforeRipple) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); loaded = true; render(); setReady(true); }
      catch { setReady(false); }
    };
    image.onerror = () => { if (active) setReady(false); };
    image.src = source; draw.current = render;
    const resize = (w: number, h: number) => {
      width = Math.max(1, Math.round(w * devicePixelRatio)); height = Math.max(1, Math.round(h * devicePixelRatio));
      render();
    };
    // Reading clientWidth during each animated draw forced layout after React's
    // SVG updates. ResizeObserver supplies the same dimensions without that cost.
    const observer = new ResizeObserver(entries => { const size = entries[0]?.contentRect; if (size) resize(size.width, size.height); }); observer.observe(surface);
    const windowResize = () => resize(surface.clientWidth, surface.clientHeight);
    window.addEventListener('resize', windowResize);
    const lost = (event: Event) => { event.preventDefault(); setReady(false); };
    const restored = () => setRevision(value => value + 1);
    surface.addEventListener('webglcontextlost', lost); surface.addEventListener('webglcontextrestored', restored);
    return () => { active = false; observer.disconnect(); window.removeEventListener('resize', windowResize); surface.removeEventListener('webglcontextlost', lost); surface.removeEventListener('webglcontextrestored', restored); draw.current = undefined; gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); };
  }, [source, revision, fit, fitBeforeRipple, alignY]);
  useEffect(() => { draw.current?.(); }, [seconds, strength, speed]);
  return <div className="chapter-ripple-scene" data-ripple-ready={ready}>
    <img src={source} alt="章节背景" style={{ visibility: ready ? 'hidden' : 'visible', objectFit: fit === 'stretch' ? 'fill' : fit, objectPosition: `50% ${alignY * 100}%` }} />
    <canvas ref={canvas} aria-label="章节背景波动" style={{ visibility: ready ? 'visible' : 'hidden' }} />
  </div>;
}
