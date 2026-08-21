import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function ThreeHeroCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const w = container.clientWidth;
    const h = container.clientHeight;

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    camera.position.set(0, 0, 36);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // ── Ambient Soft Lighting ──────────────────────────────────────
    scene.add(new THREE.AmbientLight('#ffffff', 0.8));
    const pointLight1 = new THREE.PointLight('#6366f1', 1.5, 40);
    pointLight1.position.set(-15, 12, 10);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight('#3b82f6', 1.5, 40);
    pointLight2.position.set(15, -10, 10);
    scene.add(pointLight2);

    // ── Wide Ethereal Orbital Ring System ─────────────────────────
    const ringsGroup = new THREE.Group();
    scene.add(ringsGroup);

    const createDelicateRing = (radius: number, color: string, opacity: number, rotX: number, rotY: number) => {
      const geo = new THREE.TorusGeometry(radius, 0.02, 16, 120);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = rotX;
      mesh.rotation.y = rotY;
      ringsGroup.add(mesh);
      return mesh;
    };

    const ring1 = createDelicateRing(14, '#94a3b8', 0.25, Math.PI / 3, 0.2);
    const ring2 = createDelicateRing(17, '#818cf8', 0.18, Math.PI / 2.5, -0.4);
    const ring3 = createDelicateRing(20, '#cbd5e1', 0.12, Math.PI / 4, 0.5);

    // ── Floating Constellation Route Nodes ────────────────────────
    const nodeCoords: [number, number, number][] = [
      [-19, 8, -4], [-14, 12, -2], [-10, 6, -6], [-16, -7, -3],
      [-22, -2, -5], [-7, -11, -2], [8, 12, -4], [15, 9, -2],
      [20, 4, -5], [17, -6, -3], [12, -11, -4], [22, -1, -6],
      [-4, 14, -5], [4, -13, -3], [-12, -13, -5], [19, 11, -6],
      [-21, 5, -2], [10, -5, -8]
    ];

    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);

    const sphereGeo = new THREE.SphereGeometry(0.2, 12, 12);
    const nodeMeshes: THREE.Mesh[] = [];

    nodeCoords.forEach(([x, y, z], idx) => {
      const isHub = idx % 4 === 0;
      const mat = new THREE.MeshBasicMaterial({
        color: isHub ? '#4f46e5' : '#94a3b8',
        transparent: true,
        opacity: isHub ? 0.75 : 0.45
      });
      const node = new THREE.Mesh(sphereGeo, mat);
      node.position.set(x, y, z);
      if (isHub) node.scale.setScalar(1.5);
      nodeGroup.add(node);
      nodeMeshes.push(node);

      // Subtle pulse halo around hubs
      if (isHub) {
        const haloGeo = new THREE.RingGeometry(0.45, 0.52, 32);
        const haloMat = new THREE.MeshBasicMaterial({
          color: '#6366f1',
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.set(x, y, z + 0.05);
        nodeGroup.add(halo);
      }
    });

    // ── Connecting Distribution Lines ─────────────────────────────
    const lineMat = new THREE.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.12 });
    for (let i = 0; i < nodeCoords.length; i++) {
      for (let j = i + 1; j < nodeCoords.length; j++) {
        const dx = nodeCoords[i][0] - nodeCoords[j][0];
        const dy = nodeCoords[i][1] - nodeCoords[j][1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 11) {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...nodeCoords[i]),
            new THREE.Vector3(...nodeCoords[j])
          ]);
          nodeGroup.add(new THREE.Line(geo, lineMat));
        }
      }
    }

    // ── Active Delivery Pulse Packet ──────────────────────────────
    const packetGeo = new THREE.SphereGeometry(0.25, 12, 12);
    const packetMat = new THREE.MeshBasicMaterial({ color: '#3b82f6', transparent: true, opacity: 0.9 });
    const packet = new THREE.Mesh(packetGeo, packetMat);
    scene.add(packet);

    let routeStep = 0;
    let packetProgress = 0;
    const packetRoute = [0, 1, 6, 7, 8, 9, 10, 5, 3, 4, 0];

    // ── Stardust Particle Atmosphere ──────────────────────────────
    const pCount = 90;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 55;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 35;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 15 - 5;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: '#94a3b8', size: 0.09, transparent: true, opacity: 0.3 });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // ── Mouse Interactivity ───────────────────────────────────────
    let mouseX = 0, mouseY = 0;
    const onMouse = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', onMouse);

    // ── Animation Loop ────────────────────────────────────────────
    const clock = new THREE.Clock();
    let frame: number;

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Slow elegant ring rotations
      ring1.rotation.z = t * 0.04;
      ring2.rotation.z = -t * 0.03;
      ring3.rotation.y = t * 0.025;

      // Node breathing & floating
      nodeMeshes.forEach((mesh, idx) => {
        mesh.position.y = nodeCoords[idx][1] + Math.sin(t * 0.8 + idx) * 0.15;
      });

      // Animated packet travelling on active delivery route
      packetProgress += 0.006;
      if (packetProgress >= 1) {
        packetProgress = 0;
        routeStep = (routeStep + 1) % (packetRoute.length - 1);
      }
      const fromIdx = packetRoute[routeStep];
      const toIdx = packetRoute[routeStep + 1];
      const fromPos = nodeCoords[fromIdx];
      const toPos = nodeCoords[toIdx];

      packet.position.set(
        fromPos[0] + (toPos[0] - fromPos[0]) * packetProgress,
        fromPos[1] + (toPos[1] - fromPos[1]) * packetProgress + Math.sin(t * 0.8 + fromIdx) * 0.15,
        fromPos[2] + (toPos[2] - fromPos[2]) * packetProgress + 0.2
      );

      // Ambient particle drift
      particles.rotation.y = t * 0.006;

      // Subtle responsive camera parallax
      camera.position.x += (mouseX * 1.8 - camera.position.x) * 0.02;
      camera.position.y += (mouseY * 1.2 - camera.position.y) * 0.02;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', onResize);
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />;
}
