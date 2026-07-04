'use client'

import { useEffect, useRef } from 'react'

/**
 * Reactive — живой 3D-маскот (плазменное существо на Three.js).
 * Основан на арте из /public/maskot, переосмыслен под фирменный стиль:
 *  - фиолетовая милая палитра (без резкого голубого/белого, мягкое свечение),
 *  - прозрачный фон (встраивается в карточку/пузырь обучения),
 *  - спокойная «живая» анимация: покачивание, дыхание, лёгкое вращение,
 *  - всё грузится динамически на клиенте (three не попадает в основной бандл).
 *
 * API совместим с прежним ReactiveMascot: достаточно `size`.
 */
export function Mascot3D({ size = 120, className }: { size?: number; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | null = null

    ;(async () => {
      const THREE = await import('three')
      const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js')
      const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js')
      const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js')
      const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js')
      if (disposed || !hostRef.current) return

      const host = hostRef.current
      const W = host.clientWidth || size
      const H = host.clientHeight || size
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      // ---------- Scene / Camera / Renderer (прозрачный фон) ----------
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100)
      camera.position.set(0, 0.78, 4.75)
      camera.lookAt(0, 0.82, 0)

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setSize(W, H)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setClearColor(0x000000, 0)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.0
      host.appendChild(renderer.domElement)
      renderer.domElement.style.display = 'block'

      // ---------- Свет (тёплый фиолетовый, мягкий) ----------
      scene.add(new THREE.AmbientLight(0x3a2a6a, 0.75))
      const keyLight = new THREE.DirectionalLight(0x9b6bff, 1.1)
      keyLight.position.set(3, 5, 4)
      scene.add(keyLight)
      const faceLight = new THREE.DirectionalLight(0xd9c9ff, 0.55)
      faceLight.position.set(0, 1.5, 5)
      scene.add(faceLight)
      const rimLight = new THREE.PointLight(0xb06bff, 2.4, 12, 2)
      rimLight.position.set(-3, 2, -3)
      scene.add(rimLight)
      const groundGlow = new THREE.PointLight(0x7a3cff, 1.6, 8, 2)
      groundGlow.position.set(0, -0.5, 1)
      scene.add(groundGlow)

      // Мягкое кольцо-подсветка под существом
      const ringGeo = new THREE.RingGeometry(0.85, 1.45, 64)
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x8a4bff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      const glowRing = new THREE.Mesh(ringGeo, ringMat)
      glowRing.rotation.x = -Math.PI / 2
      glowRing.position.y = -0.62
      scene.add(glowRing)

      // ---------- Общие uniforms ----------
      const clock = new THREE.Clock()
      const U = { uTime: { value: 0 }, uPulse: { value: 0.4 }, uBurst: { value: 0 } }

      // ---------- Плазменное тело (полупрозрачное, фиолетовое) ----------
      const bodyVert = `
        uniform float uTime; uniform float uPulse; uniform float uBurst;
        varying vec3 vNormal; varying vec3 vViewPosition; varying vec3 vWorldPosition; varying float vNoise;
        float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float noise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
          float n000=hash(i),n100=hash(i+vec3(1,0,0)),n010=hash(i+vec3(0,1,0)),n110=hash(i+vec3(1,1,0));
          float n001=hash(i+vec3(0,0,1)),n101=hash(i+vec3(1,0,1)),n011=hash(i+vec3(0,1,1)),n111=hash(i+vec3(1,1,1));
          return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z); }
        void main(){
          vNormal=normalize(normalMatrix*normal); vec3 pos=position;
          float n=noise(pos*2.5+uTime*0.6); vNoise=n;
          float wobble=sin(uTime*2.0+pos.y*3.0)*0.02;
          float pulseAmt=(0.015+uPulse*0.05)*(0.5+0.5*sin(uTime*1.6));
          float burstAmt=uBurst*0.05*n;
          pos+=normal*(wobble+pulseAmt+burstAmt);
          vec4 worldPos=modelMatrix*vec4(pos,1.0); vWorldPosition=worldPos.xyz;
          vec4 mvPosition=viewMatrix*worldPos; vViewPosition=-mvPosition.xyz;
          gl_Position=projectionMatrix*mvPosition;
        }`
      const bodyFrag = `
        uniform float uTime; uniform float uPulse; uniform float uBurst;
        uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorCore;
        varying vec3 vNormal; varying vec3 vViewPosition; varying vec3 vWorldPosition; varying float vNoise;
        void main(){
          vec3 viewDir=normalize(vViewPosition);
          float fresnel=pow(1.0-max(dot(vNormal,viewDir),0.0),2.2);
          float grad=clamp(vWorldPosition.y*0.35+0.5+vNoise*0.2,0.0,1.0);
          vec3 baseColor=mix(uColorA,uColorB,grad);
          float innerGlow=0.4+0.6*sin(uTime*1.8+vWorldPosition.y*4.0);
          innerGlow*=(0.6+uPulse*0.8);
          vec3 coreGlow=uColorCore*innerGlow*0.55;
          vec3 color=baseColor*0.72+coreGlow*0.45;
          color+=fresnel*mix(uColorB,vec3(1.0),0.2)*(1.0+uPulse*0.45);
          color+=uBurst*vec3(0.8,0.65,1.0)*fresnel*1.2;
          float alpha=clamp(0.74+fresnel*0.4+uPulse*0.1,0.62,0.99);
          gl_FragColor=vec4(color,alpha);
        }`
      const mkBody = (a: number, b: number, core: number) => new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uPulse: U.uPulse, uBurst: U.uBurst,
          uColorA: { value: new THREE.Color(a) }, uColorB: { value: new THREE.Color(b) }, uColorCore: { value: new THREE.Color(core) } },
        vertexShader: bodyVert, fragmentShader: bodyFrag, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.NormalBlending,
      })
      const plasma = mkBody(0x6326d6, 0x9b66ff, 0xc9b3ff)   // тело — насыщенный фиолет
      const bellyMat = mkBody(0xc4aaff, 0xe8ddff, 0xf6f0ff)  // животик — светлая лаванда

      // ---------- Языки-искры (мягкая лаванда) ----------
      const spikeVert = `
        uniform float uTime; uniform float uPulse; uniform float uBurst;
        attribute float aRand; varying float vRand; varying float vHeight;
        void main(){ vRand=aRand; vHeight=uv.y; vec3 pos=position;
          float sway=sin(uTime*3.0+aRand*6.28)*0.06*vHeight;
          float flicker=(0.5+0.5*sin(uTime*8.0+aRand*10.0))*uBurst*0.08*vHeight;
          pos.x+=sway+flicker; pos.z+=cos(uTime*2.5+aRand*6.28)*0.05*vHeight; pos*=(1.0+uPulse*0.08*vHeight);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0); }`
      const spikeFrag = `
        uniform vec3 uColorTip; uniform vec3 uColorBase; uniform float uTime;
        varying float vRand; varying float vHeight;
        void main(){ vec3 color=mix(uColorBase,uColorTip,vHeight);
          float flicker=0.82+0.18*sin(uTime*10.0+vRand*20.0);
          float alpha=smoothstep(0.0,0.15,vHeight)*(1.0-vHeight*0.3);
          gl_FragColor=vec4(color*flicker*1.1,alpha*0.85); }`
      const spikeMat = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uPulse: U.uPulse, uBurst: U.uBurst,
          uColorTip: { value: new THREE.Color(0xc4a9ff) }, uColorBase: { value: new THREE.Color(0x6a34e0) } },
        vertexShader: spikeVert, fragmentShader: spikeFrag, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      })

      // ---------- Риг (кости для анимации) ----------
      const creatureRoot = new THREE.Group(); scene.add(creatureRoot)
      const hips = new THREE.Group(); hips.position.set(0, 0.1, 0); creatureRoot.add(hips)
      const spine = new THREE.Group(); spine.position.set(0, 0.35, 0); hips.add(spine)
      const chest = new THREE.Group(); chest.position.set(0, 0.45, 0); spine.add(chest)
      const head = new THREE.Group(); head.position.set(0, 0.55, 0.05); chest.add(head)
      const tail = new THREE.Group(); tail.position.set(0, 0.1, -0.35); hips.add(tail)

      const makeLimb = (parent: any, x: number, y: number, z: number) => {
        const shoulder = new THREE.Group(); shoulder.position.set(x, y, z); parent.add(shoulder)
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.35, 6, 10), plasma); m.position.set(0, -0.2, 0); shoulder.add(m)
        return shoulder
      }
      const armL = makeLimb(chest, -0.42, 0.05, 0.05)
      const armR = makeLimb(chest, 0.42, 0.05, 0.05)
      const legL = makeLimb(hips, -0.25, -0.15, 0.05)
      const legR = makeLimb(hips, 0.25, -0.15, 0.05)

      const bodyGeo = new THREE.SphereGeometry(0.62, 48, 48); bodyGeo.scale(1, 1.15, 0.92)
      chest.add(new THREE.Mesh(bodyGeo, plasma))
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), bellyMat)
      belly.position.set(0, -0.05, 0.32); belly.scale.set(0.85, 0.9, 0.6); chest.add(belly)
      const headGeo = new THREE.SphereGeometry(0.42, 40, 40); headGeo.scale(1, 0.95, 0.95)
      head.add(new THREE.Mesh(headGeo, plasma))

      const makeHorn = (x: number) => {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 8), plasma)
        horn.position.set(x, 0.4, -0.05); horn.rotation.z = x > 0 ? -0.35 : 0.35; head.add(horn)
      }
      makeHorn(-0.16); makeHorn(0.16)

      const tailGeo = new THREE.ConeGeometry(0.14, 0.6, 10); tailGeo.translate(0, -0.3, 0)
      const tailMesh = new THREE.Mesh(tailGeo, plasma); tailMesh.rotation.x = Math.PI * 0.55; tail.add(tailMesh)

      // ---------- Глазки (мягкое лавандовое свечение) ----------
      const makeEye = (x: number) => {
        const g = new THREE.Group(); g.position.set(x, 0.06, 0.37)
        // тёмно-фиолетовая радужка — контраст на светлом лице
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 24), new THREE.MeshBasicMaterial({ color: 0x3a1d7a })))
        // светящийся ободок
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 18), new THREE.MeshBasicMaterial({ color: 0x9b66ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
        g.add(glow)
        // белый блик — «милый» глаз
        const spark = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }))
        spark.position.set(x > 0 ? -0.035 : 0.035, 0.04, 0.1); g.add(spark)
        g.add(new THREE.PointLight(0x9b66ff, 0.5, 1.5, 2))
        head.add(g)
        return g
      }
      const eyeL = makeEye(-0.17)
      const eyeR = makeEye(0.17)
      // милая улыбка (тонкая дуга)
      const smileCurve = new THREE.EllipseCurve(0, 0, 0.12, 0.07, Math.PI * 1.15, Math.PI * 1.85, false, 0)
      const smilePts = smileCurve.getPoints(24).map((p: any) => new THREE.Vector3(p.x, p.y, 0))
      const smile = new THREE.Line(new THREE.BufferGeometry().setFromPoints(smilePts), new THREE.LineBasicMaterial({ color: 0x5a2fb0, transparent: true, opacity: 0.9 }))
      smile.position.set(0, -0.12, 0.42); head.add(smile)

      // ---------- Языки на голове/спине ----------
      const createSpikeGeo = (baseR: number, height: number, seg: number) => {
        const geo = new THREE.ConeGeometry(baseR, height, seg, 6, true); geo.translate(0, height / 2, 0)
        const uvAttr = geo.attributes.uv, posAttr = geo.attributes.position
        for (let i = 0; i < posAttr.count; i++) uvAttr.setY(i, posAttr.getY(i) / height)
        const rand = new Float32Array(posAttr.count); const r = Math.random()
        for (let i = 0; i < posAttr.count; i++) rand[i] = r
        geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1))
        return geo
      }
      const spikePositions = [
        { x: 0, y: 0.75, z: -0.1, s: 1.3, p: 'head' }, { x: -0.12, y: 0.7, z: -0.2, s: 1.0, p: 'head' }, { x: 0.12, y: 0.7, z: -0.2, s: 1.0, p: 'head' },
        { x: 0, y: 0.35, z: -0.45, s: 1.1, p: 'chest' }, { x: -0.15, y: 0.15, z: -0.5, s: 0.85, p: 'chest' }, { x: 0.15, y: 0.15, z: -0.5, s: 0.85, p: 'chest' },
        { x: 0, y: -0.05, z: -0.5, s: 0.7, p: 'hips' },
      ]
      spikePositions.forEach((sp) => {
        const mesh = new THREE.Mesh(createSpikeGeo(0.06 * sp.s, 0.4 * sp.s, 8), spikeMat)
        if (sp.p === 'head') { mesh.position.set(sp.x, sp.y - 0.55, sp.z - 0.05); head.add(mesh) }
        else if (sp.p === 'chest') { mesh.position.set(sp.x, sp.y, sp.z); chest.add(mesh) }
        else { mesh.position.set(sp.x, sp.y, sp.z); hips.add(mesh) }
        mesh.rotation.x = -0.3 + Math.random() * 0.15
      })

      // ---------- Искры (частицы, фиолетовые) ----------
      const PC = 130
      const pGeo = new THREE.BufferGeometry()
      const pPos = new Float32Array(PC * 3), pSeed = new Float32Array(PC), pSpeed = new Float32Array(PC), pOff = new Float32Array(PC)
      for (let i = 0; i < PC; i++) {
        const th = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.5
        pPos[i * 3] = Math.cos(th) * r; pPos[i * 3 + 1] = Math.random() * 1.4 - 0.3; pPos[i * 3 + 2] = Math.sin(th) * r
        pSeed[i] = Math.random() * 100; pSpeed[i] = 0.3 + Math.random() * 0.7; pOff[i] = Math.random()
      }
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
      pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1))
      pGeo.setAttribute('aSpeed', new THREE.BufferAttribute(pSpeed, 1))
      pGeo.setAttribute('aOffset', new THREE.BufferAttribute(pOff, 1))
      const pMat = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uBurst: U.uBurst },
        vertexShader: `uniform float uTime; uniform float uBurst; attribute float aSeed; attribute float aSpeed; attribute float aOffset; varying float vAlpha;
          void main(){ vec3 pos=position; float t=fract(uTime*0.15*aSpeed+aOffset); pos.y+=t*1.8;
            pos.x+=sin(uTime*1.5+aSeed)*0.15*(1.0+uBurst); pos.z+=cos(uTime*1.3+aSeed)*0.15*(1.0+uBurst);
            vAlpha=(1.0-t)*(0.55+uBurst*0.5); vec4 mv=modelViewMatrix*vec4(pos,1.0);
            gl_PointSize=(12.0+uBurst*16.0)*(1.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
        fragmentShader: `varying float vAlpha; void main(){ vec2 c=gl_PointCoord-vec2(0.5); float d=length(c);
          float a=smoothstep(0.5,0.0,d)*vAlpha; vec3 color=mix(vec3(0.62,0.42,1.0),vec3(0.80,0.66,1.0),0.5);
          gl_FragColor=vec4(color,a); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
      const sparks = new THREE.Points(pGeo, pMat); sparks.position.set(0, 0.2, 0); creatureRoot.add(sparks)

      // ---------- Bloom (мягкий, чтобы не резал глаза) ----------
      const composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.55, 0.62)
      composer.addPass(bloom)
      composer.addPass(new OutputPass())

      // ---------- Анимация: спокойный idle + лёгкое вращение ----------
      const animate = () => {
        const dt = Math.min(clock.getDelta(), 0.05)
        const t = clock.getElapsedTime()
        U.uTime.value = t
        const speed = reduce ? 0 : 1
        const breathe = Math.sin(t * 1.8 * speed)
        U.uPulse.value = 0.38 + 0.22 * (0.5 + 0.5 * breathe)
        chest.scale.setScalar(1 + breathe * 0.02)
        head.position.y = 0.55 + Math.sin(t * 1.8 * speed + 0.3) * 0.015
        creatureRoot.position.y = Math.sin(t * 1.1 * speed) * 0.06
        creatureRoot.rotation.y = reduce ? 0.2 : Math.sin(t * 0.5) * 0.5
        armL.rotation.z = 0.16 + Math.sin(t * 1.5 * speed) * 0.06
        armR.rotation.z = -0.16 - Math.sin(t * 1.5 * speed) * 0.06
        tail.rotation.y = Math.sin(t * 1.3 * speed) * 0.3
        tail.rotation.x = Math.sin(t * 0.9 * speed) * 0.1
        legL.rotation.x = Math.sin(t * 1.2 * speed) * 0.03
        legR.rotation.x = -Math.sin(t * 1.2 * speed) * 0.03
        glowRing.rotation.z += dt * 0.15
        eyeL.children[1].scale.setScalar(1 + Math.sin(t * 3.0 * speed) * 0.1)
        eyeR.children[1].scale.setScalar(1 + Math.sin(t * 3.0 * speed + 0.5) * 0.1)
        composer.render()
      }
      renderer.setAnimationLoop(animate)

      // ---------- Ресайз под контейнер ----------
      const onResize = () => {
        const w = host.clientWidth || size, h = host.clientHeight || size
        camera.aspect = w / h; camera.updateProjectionMatrix()
        renderer.setSize(w, h); composer.setSize(w, h)
      }
      const ro = new ResizeObserver(onResize)
      ro.observe(host)

      cleanup = () => {
        ro.disconnect()
        renderer.setAnimationLoop(null)
        composer.dispose?.()
        renderer.dispose()
        scene.traverse((o: any) => { o.geometry?.dispose?.(); if (o.material) { Array.isArray(o.material) ? o.material.forEach((m: any) => m.dispose()) : o.material.dispose() } })
        if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
      }
    })().catch(() => {})

    return () => { disposed = true; cleanup?.() }
  }, [size])

  return <div ref={hostRef} className={className} style={{ width: size, height: size }} aria-label="Reactive" role="img" />
}
