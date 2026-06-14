// OrbCore3D — the orchestrator's WebGL heart.
//
// A shader sphere (animated simplex plasma + fresnel rim) wrapped in an
// additive glow halo, an orbiting particle field and two precessing hairline
// rings. Additive light blending is the thing CSS can't do — it's what makes
// the orb read as energy instead of gradients.
//
// Contract with the deck:
//  - `state` drives color + tempo (standby gray-ember → active coral →
//    thinking hot → voice listening/transcribing/speaking retints), all
//    transitions smoothly lerped in the render loop, never snapped.
//  - `level` is the live mic RMS (0..1) while listening — the halo and core
//    breathe with the operator's voice.
//  - `paused` (window hidden) parks the render loop entirely — zero GPU.
//  - If WebGL context creation fails, `onFallback` lets the caller keep the
//    old CSS orb instead.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type OrbState = 'standby' | 'active' | 'thinking' | 'listening' | 'transcribing' | 'speaking';

interface Props {
  state: OrbState;
  level: number; // 0..1 mic level while listening
  paused: boolean;
  onFallback: () => void;
}

const STATE_TINT: Record<OrbState, { color: number; heat: number; speed: number }> = {
  standby:      { color: 0x9a4a55, heat: 0.32, speed: 0.45 },
  active:       { color: 0xf64e6e, heat: 0.85, speed: 1.0 },
  thinking:     { color: 0xff6a5e, heat: 1.25, speed: 2.1 },
  listening:    { color: 0xf64e6e, heat: 1.0, speed: 0.8 },
  transcribing: { color: 0xa78bfa, heat: 1.05, speed: 1.6 },
  speaking:     { color: 0x22d3ee, heat: 1.2, speed: 1.5 },
};

const SPHERE_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  // ── Ashima 3D simplex noise (compact) ──
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPos = position;
    // Living surface — a gentle noise displacement so the silhouette breathes.
    float d = snoise(position * 2.2 + vec3(0.0, uTime * 0.25, 0.0)) * 0.035;
    vec3 p = position + normal * d;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const SPHERE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uHeat;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  // (same noise, declared again for the fragment stage)
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  void main() {
    // Plasma — two octaves of drifting noise, banded into filaments.
    float n = snoise(vPos * 2.6 + vec3(uTime * 0.18, uTime * 0.12, 0.0)) * 0.6
            + snoise(vPos * 6.0 - vec3(0.0, uTime * 0.3, uTime * 0.1)) * 0.4;
    float bands = smoothstep(0.05, 0.65, n);
    vec3 deep = uColor * 0.08;
    vec3 mid  = uColor * (0.35 + 0.45 * bands) * uHeat;
    // Fresnel rim — the glass-edge light.
    float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.4);
    vec3 rim = mix(uColor, vec3(1.0), 0.45) * fres * (1.4 * uHeat);
    // Top key-light so it reads as a sphere, not a disc.
    float key = pow(max(dot(normalize(vNormal), normalize(vec3(-0.35, 0.7, 0.6))), 0.0), 2.0);
    vec3 col = deep + mid + rim + uColor * key * 0.35 * uHeat;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Soft radial sprite texture (white core → transparent) shared by halo + particles. */
function makeGlowTexture(size: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export default function OrbCore3D({ state, level, paused, onFallback }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const pausedRef = useRef(paused);
  stateRef.current = state;
  levelRef.current = level;
  pausedRef.current = paused;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      onFallback();
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // fov/z chosen so the sphere lands at ~50% of the .core box once the
    // canvas renders at 160% (the overflow carries the halo + rings).
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
    camera.position.set(0, 0, 6.5);

    const uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(STATE_TINT.standby.color) },
      uHeat: { value: STATE_TINT.standby.heat },
    };
    const sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 32),
      new THREE.ShaderMaterial({ vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG, uniforms }),
    );
    scene.add(sphere);

    const glowTex = makeGlowTexture(128);

    // Additive halo sprite behind the sphere.
    const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: STATE_TINT.standby.color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(3.4);
    scene.add(halo);

    // Particle field — three shells of orbiting motes, additive.
    const COUNT = 240;
    const pos = new Float32Array(COUNT * 3);
    const seed: { r: number; th: number; ph: number; sp: number }[] = [];
    for (let i = 0; i < COUNT; i++) {
      const r = 1.45 + Math.random() * 1.15;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      seed.push({ r, th, ph, sp: 0.05 + Math.random() * 0.25 });
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.55;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pmat = new THREE.PointsMaterial({ map: glowTex, color: STATE_TINT.standby.color, size: 0.05, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.85, sizeAttenuation: true });
    const points = new THREE.Points(pgeo, pmat);
    scene.add(points);

    // Two precessing hairline rings.
    const mkRing = (radius: number, opacity: number) => {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.0045, 8, 160),
        new THREE.MeshBasicMaterial({ color: STATE_TINT.standby.color, blending: THREE.AdditiveBlending, transparent: true, opacity, depthWrite: false }),
      );
      scene.add(m);
      return m;
    };
    const ringA = mkRing(1.55, 0.55);
    const ringB = mkRing(1.85, 0.35);

    // Size to host (the .core div is responsive via clamp()). The buffer is
    // 1.6× the box — the CSS positions the canvas at 160% centered, so the
    // additive halo and rings overflow the core without clipping or blur.
    const fit = () => {
      const s = Math.max(1, Math.min(host.clientWidth, host.clientHeight)) * 1.6;
      renderer.setSize(s, s, false);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);

    const tgtColor = new THREE.Color();
    let heat = STATE_TINT.standby.heat;
    let speed = STATE_TINT.standby.speed;
    let t = 0;
    let last = performance.now();
    let raf = 0;
    let disposed = false;
    // Reduced motion: render a static frame, re-render only on state change.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastStatic: OrbState | null = null;

    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (pausedRef.current) { last = now; return; } // parked — no GPU work
      if (reduced) {
        if (lastStatic === stateRef.current) return;
        lastStatic = stateRef.current;
        const tint = STATE_TINT[stateRef.current];
        uniforms.uColor.value.setHex(tint.color);
        uniforms.uHeat.value = tint.heat;
        haloMat.color.copy(uniforms.uColor.value);
        pmat.color.copy(uniforms.uColor.value);
        (ringA.material as THREE.MeshBasicMaterial).color.copy(uniforms.uColor.value);
        (ringB.material as THREE.MeshBasicMaterial).color.copy(uniforms.uColor.value);
        ringA.rotation.set(Math.PI / 2.4, 0.6, 0.3);
        ringB.rotation.set(Math.PI / 1.9, -0.4, 0.2);
        renderer.render(scene, camera);
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const tint = STATE_TINT[stateRef.current];
      const boost = stateRef.current === 'listening' ? levelRef.current * 1.4 : 0;
      // Smooth everything — premium means no snapping.
      tgtColor.setHex(tint.color);
      uniforms.uColor.value.lerp(tgtColor, 1 - Math.exp(-dt * 4));
      heat += ((tint.heat + boost) - heat) * (1 - Math.exp(-dt * 5));
      speed += (tint.speed - speed) * (1 - Math.exp(-dt * 3));
      uniforms.uHeat.value = heat;
      t += dt * speed;
      uniforms.uTime.value = t;

      haloMat.color.copy(uniforms.uColor.value);
      haloMat.opacity = 0.4 + heat * 0.22 + boost * 0.25;
      halo.scale.setScalar(3.2 + Math.sin(t * 0.9) * 0.12 + boost * 0.7);

      pmat.color.copy(uniforms.uColor.value);
      const parr = pgeo.attributes.position.array as Float32Array;
      for (let i = 0; i < COUNT; i++) {
        const s = seed[i];
        s.th += dt * s.sp * speed;
        parr[i * 3] = s.r * Math.sin(s.ph) * Math.cos(s.th);
        parr[i * 3 + 2] = s.r * Math.sin(s.ph) * Math.sin(s.th);
      }
      pgeo.attributes.position.needsUpdate = true;

      (ringA.material as THREE.MeshBasicMaterial).color.copy(uniforms.uColor.value);
      (ringB.material as THREE.MeshBasicMaterial).color.copy(uniforms.uColor.value);
      ringA.rotation.set(Math.PI / 2.4, t * 0.21, t * 0.12);
      ringB.rotation.set(Math.PI / 1.9, -t * 0.14, t * 0.08);

      sphere.rotation.y = t * 0.1;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      sphere.geometry.dispose();
      (sphere.material as THREE.Material).dispose();
      pgeo.dispose();
      pmat.dispose();
      haloMat.dispose();
      glowTex.dispose();
      [ringA, ringB].forEach((r) => { r.geometry.dispose(); (r.material as THREE.Material).dispose(); });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="layer orb-gl" />;
}
