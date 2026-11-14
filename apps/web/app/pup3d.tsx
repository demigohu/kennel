"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// The hero pup: a rigged, animated 3D canid (Khronos glTF sample "Fox": model CC0 by PixelMannen, rigging and
// animation CC-BY 4.0 by tomkranis, glTF conversion CC-BY 4.0 by @AsoboStudio and @scurest) rendered with three.js
// into a tiny offscreen buffer, one pixel per glyph cell, then drawn as ASCII. It strolls the ground plane on its own
// (Walk / Survey) and runs to eat the 3D bones you drop with a click (Run).

const RAMP = " ·:/+×#■";
const INK = "#60CE8B";
const DIM = "#3a8a5a";
const FAINT = "#1d4a30";
const CELL = 8;

export function Pup3D({ onFed }: { onFed?: (n: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fedRef = useRef(onFed);
  fedRef.current = onFed;

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, cols = 1, rows = 1, dpr = 1, raf = 0, disposed = false;

    // Render to the GL canvas, copy it into a tiny 2D canvas and read that back (reliable across GPUs/headless).
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
    const sample = document.createElement("canvas");
    const sctx = sample.getContext("2d", { willReadFrequently: true })!;
    let pixels: Uint8ClampedArray = new Uint8ClampedArray(4);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-3, 6, 5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

    camera.position.set(0, 3.8, 7.6);
    camera.lookAt(0, 0.5, 0);
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Raycaster();

    // Bone: a shaft and four knobs, bright so it reads as the lightest glyphs.
    const boneMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const makeBone = () => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), boneMat);
      shaft.rotation.z = Math.PI / 2;
      g.add(shaft);
      for (const [x, z] of [[-0.27, -0.07], [-0.27, 0.07], [0.27, -0.07], [0.27, 0.07]] as const) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), boneMat);
        knob.position.set(x, 0, z);
        g.add(knob);
      }
      g.position.y = 0.09;
      return g;
    };
    const bones: { obj: THREE.Group; y: number; vy: number; landed: boolean }[] = [];
    const crumbs: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    let fed = 0;

    // Fox state on the ground plane
    const fox = { pos: new THREE.Vector3(0, 0, 0.5), heading: Math.PI / 2, speed: 0 };
    let model: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const actions: Record<string, THREE.AnimationAction> = {};
    let current = "";
    const play = (name: string) => {
      const next = actions[name];
      if (current === name || !next) return;
      next.reset().fadeIn(0.3).play();
      actions[current]?.fadeOut(0.3);
      current = name;
    };
    let wander = new THREE.Vector3(0, 0, 0.5);
    let wanderAt = 0;

    /** Point on the ground under normalized device coords; keeps every target on screen. */
    const groundAt = (nx: number, ny: number) => {
      ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const p = new THREE.Vector3();
      return ray.ray.intersectPlane(ground, p) ? p : null;
    };

    new GLTFLoader().load("/models/fox.glb", (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(3 / Math.max(size.x, size.z));

      // Keep the model's own (skinning-ready) material but drop its texture: glyph brightness comes from light alone.
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
          m.map = null;
          m.color.set(0xffffff);
          m.roughness = 0.9;
          m.metalness = 0;
          m.needsUpdate = true;
          // The skinned mesh's bind-pose bounds are wrong once animated; never cull it.
          o.frustumCulled = false;
        }
      });
      scene.add(model);
      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
      play("Survey");
    });

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = el.clientWidth;
      H = el.clientHeight;
      el.width = W * dpr;
      el.height = H * dpr;
      cols = Math.max(1, Math.floor(W / CELL));
      rows = Math.max(1, Math.floor(H / CELL));
      renderer.setSize(cols, rows, false);
      sample.width = cols;
      sample.height = rows;
      camera.aspect = cols / rows;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const toScreen = (v: THREE.Vector3) => {
      const p = v.clone().project(camera);
      return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H };
    };

    const clock = new THREE.Clock();
    const step = (dt: number, t: number) => {
      const bone = bones.find((b) => b.landed);
      let goal: THREE.Vector3;
      let pace: number;
      if (bone) {
        goal = bone.obj.position;
        pace = 3.2;
      } else {
        if (t > wanderAt) {
          const pause = Math.random() < 0.3;
          const next = pause ? null : groundAt((Math.random() - 0.5) * 1.4, -0.75 + Math.random() * 1.0);
          if (next) wander = next;
          else wander = fox.pos.clone();
          wanderAt = t + (pause ? 1.5 + Math.random() * 2 : 3 + Math.random() * 3);
        }
        goal = wander;
        pace = 0.9;
      }
      const to = new THREE.Vector3().subVectors(goal, fox.pos).setY(0);
      const dist = to.length();
      const want = dist > 0.12 ? Math.min(pace, dist * 2) : 0;
      fox.speed += (want - fox.speed) * Math.min(1, dt * 3);
      if (dist > 0.05) {
        const desired = Math.atan2(to.x, to.z);
        let diff = desired - fox.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        fox.heading += Math.max(-1, Math.min(1, diff)) * Math.min(1, dt * (bone ? 6 : 3));
      }
      fox.pos.x += Math.sin(fox.heading) * fox.speed * dt;
      fox.pos.z += Math.cos(fox.heading) * fox.speed * dt;
      play(fox.speed > 1.6 ? "Run" : fox.speed > 0.15 ? "Walk" : "Survey");
      if (actions.Walk) actions.Walk.timeScale = 0.6 + fox.speed;
      if (model) {
        model.position.copy(fox.pos);
        model.rotation.y = fox.heading;
      }
      // Bones drop onto the ground; the fox eats the one at its nose.
      for (const b of bones) {
        if (!b.landed) {
          b.vy -= 18 * dt;
          b.obj.position.y = Math.max(0.09, b.obj.position.y + b.vy * dt);
          if (b.obj.position.y <= 0.09) b.landed = true;
        }
        b.obj.rotation.y += dt * 0.8;
      }
      const nose = fox.pos.clone().add(new THREE.Vector3(Math.sin(fox.heading), 0, Math.cos(fox.heading)).multiplyScalar(0.9));
      const i = bones.findIndex((b) => b.landed && b.obj.position.distanceTo(new THREE.Vector3(nose.x, 0.09, nose.z)) < 0.45);
      if (i >= 0) {
        const b = bones.splice(i, 1)[0]!;
        scene.remove(b.obj);
        const s = toScreen(b.obj.position);
        for (let k = 0; k < 16; k++) crumbs.push({ x: s.x, y: s.y, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 320, life: 0.8 });
        fed++;
        fedRef.current?.(fed);
      }
      mixer?.update(dt);
      void t;
    };

    const draw = (dt: number, t: number) => {
      renderer.render(scene, camera);
      sctx.drawImage(renderer.domElement, 0, 0, cols, rows);
      pixels = sctx.getImageData(0, 0, cols, rows).data;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.font = `${CELL}px "Departure Mono", monospace`;
      ctx.textBaseline = "top";
      for (let r = 0; r < rows; r++) {
        const src = r * cols * 4;
        for (let c = 0; c < cols; c++) {
          const i = src + c * 4;
          const l = (0.3 * pixels[i]! + 0.59 * pixels[i + 1]! + 0.11 * pixels[i + 2]!) / 255;
          if (l < 0.04) continue;
          const x = c * CELL, y = r * CELL;
          const ch = RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(l * (RAMP.length - 1)))]!;
          const alpha = 1;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = l > 0.55 ? INK : l > 0.25 ? DIM : FAINT;
          ctx.fillText(ch, x, y);
        }
      }
      // Ground grain under the fox, then crumbs.
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = INK;
      const shadow = toScreen(fox.pos);
      for (let k = -5; k <= 5; k++) ctx.fillText("·", shadow.x + k * CELL * 1.5, shadow.y);
      ctx.fillStyle = "#b8f5cf";
      for (const c of crumbs) {
        c.vy += 1400 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.life -= dt;
        ctx.globalAlpha = Math.max(0, c.life);
        ctx.fillText("·", c.x, c.y);
      }
      ctx.globalAlpha = 1;
      for (let k = crumbs.length - 1; k >= 0; k--) if (crumbs[k]!.life <= 0) crumbs.splice(k, 1);
    };

    const loop = () => {
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      step(dt, t);
      draw(dt, t);
      if (!reduce) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Reduced motion: one still frame once the model has loaded.
    const still = reduce ? window.setTimeout(() => draw(0, 0), 600) : 0;

    const onClick = (e: MouseEvent) => {
      if (bones.length >= 4) return;
      const r = el.getBoundingClientRect();
      const p = groundAt(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      if (!p) return;
      const obj = makeBone();
      obj.position.set(p.x, 1.6, p.z);
      scene.add(obj);
      bones.push({ obj, y: 1.6, vy: 0, landed: false });
    };
    el.addEventListener("click", onClick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(still);
      ro.disconnect();
      el.removeEventListener("click", onClick);
      renderer.dispose();
    };
  }, []);

  return (
    <canvas ref={canvas} className="runner runner-chase" role="img"
      aria-label="A 3D ASCII pup strolling around. Click to drop a bone and it runs to eat it." />
  );
}
