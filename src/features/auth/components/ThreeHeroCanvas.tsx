import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ThreeHeroCanvasProps {
  activeStep: number;
  onStepChange?: (stepIndex: number) => void;
  isReducedMotion?: boolean;
}

export interface NodeData {
  id: string;
  name: string;
  sub: string;
  stepIndex: number;
  tPos: number; // Position on curve 0..1
  position: [number, number, number];
  color: string;
}

export const ROUTE_NODES: NodeData[] = [
  { id: 'depot', name: 'Master Distribution Hub', sub: 'FMCG Depot & Pallet Dispatch', stepIndex: 0, tPos: 0.02, position: [-13, 0, -6], color: '#2563eb' },
  { id: 'batch', name: 'SAP Digital Batching', sub: 'Automated Picklist Engine', stepIndex: 1, tPos: 0.20, position: [-5, 0, 7], color: '#4f46e5' },
  { id: 'dispatch', name: 'Smart Route Dispatch', sub: 'AI Driver Navigation', stepIndex: 2, tPos: 0.40, position: [6, 0, 9], color: '#0284c7' },
  { id: 'retail', name: 'Retail Store Drop-off', sub: 'Party Proof of Delivery', stepIndex: 3, tPos: 0.60, position: [13, 0, 1], color: '#059669' },
  { id: 'payment', name: 'Instant Reconciliation', sub: 'Cash & UPI Clearance', stepIndex: 4, tPos: 0.80, position: [7, 0, -9], color: '#d97706' },
  { id: 'intelligence', name: 'Executive Intelligence', sub: 'Real-time Velocity & Margins', stepIndex: 5, tPos: 0.95, position: [-4, 0, -11], color: '#7c3aed' },
];

export function ThreeHeroCanvas({ activeStep, onStepChange: _onStepChange, isReducedMotion = false }: ThreeHeroCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeStepRef = useRef(activeStep);
  activeStepRef.current = activeStep;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── 1. SCENE, FOG & CAMERA ─────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f8faff');
    scene.fog = new THREE.FogExp2('#f8faff', 0.012);

    const width = container.clientWidth;
    const height = container.clientHeight;

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 300);
    const defaultCamPos = new THREE.Vector3(0, 28, 38);
    camera.position.copy(defaultCamPos);
    const cameraTarget = new THREE.Vector3(0, 0, 0);
    camera.lookAt(cameraTarget);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    container.appendChild(renderer.domElement);

    // ── 2. LIGHTING ────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight('#ffffff', 1.4);
    scene.add(ambient);

    const hemiLight = new THREE.HemisphereLight('#eff6ff', '#e2e8f0', 1.1);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight('#fffbeb', 2.2);
    sunLight.position.set(25, 40, 20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.bias = -0.0003;
    const shadowDist = 30;
    sunLight.shadow.camera.left = -shadowDist;
    sunLight.shadow.camera.right = shadowDist;
    sunLight.shadow.camera.top = shadowDist;
    sunLight.shadow.camera.bottom = -shadowDist;
    scene.add(sunLight);

    const softFill = new THREE.DirectionalLight('#bfdbfe', 0.8);
    softFill.position.set(-20, 20, -20);
    scene.add(softFill);

    // ── 3. GROUND PLATFORM & SUBTLE GRID ───────────────────────────────────
    const groundGeo = new THREE.PlaneGeometry(130, 130);
    const groundMat = new THREE.MeshStandardMaterial({
      color: '#f1f5f9',
      roughness: 0.85,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(100, 50, '#94a3b8', '#e2e8f0');
    gridHelper.position.y = 0.01;
    (gridHelper.material as THREE.Material).opacity = 0.45;
    (gridHelper.material as THREE.Material).transparent = true;
    scene.add(gridHelper);

    // ── 4. SPLINE HIGHWAY TRACK ────────────────────────────────────────────
    const curvePoints = ROUTE_NODES.map((n) => new THREE.Vector3(...n.position));
    const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal', 0.5);

    // Main road ribbon
    const tubeGeo = new THREE.TubeGeometry(curve, 160, 0.45, 12, true);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: '#3b82f6',
      roughness: 0.3,
      metalness: 0.2,
      emissive: '#1d4ed8',
      emissiveIntensity: 0.35,
    });
    const roadMesh = new THREE.Mesh(tubeGeo, tubeMat);
    roadMesh.position.y = 0.25;
    roadMesh.castShadow = true;
    scene.add(roadMesh);

    // Outer glowing circuit ring
    const outerTubeGeo = new THREE.TubeGeometry(curve, 160, 0.65, 8, true);
    const outerTubeMat = new THREE.MeshBasicMaterial({
      color: '#60a5fa',
      transparent: true,
      opacity: 0.2,
      wireframe: true,
    });
    const outerRingMesh = new THREE.Mesh(outerTubeGeo, outerTubeMat);
    outerRingMesh.position.y = 0.25;
    scene.add(outerRingMesh);

    // ── 5. 3D STATIONS / HUBS ──────────────────────────────────────────────
    const animatedObjects: Array<{
      mesh: THREE.Object3D;
      update: (time: number) => void;
    }> = [];

    const createStationBase = (pos: [number, number, number], colorHex: string) => {
      const group = new THREE.Group();
      group.position.set(...pos);

      // Base cylinder
      const baseGeo = new THREE.CylinderGeometry(2.4, 2.7, 0.4, 32);
      const baseMat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.2,
        metalness: 0.1,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = 0.2;
      baseMesh.receiveShadow = true;
      baseMesh.castShadow = true;
      group.add(baseMesh);

      // Glowing color ring
      const ringGeo = new THREE.TorusGeometry(2.3, 0.08, 16, 48);
      const ringMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 0.8,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.42;
      group.add(ring);

      // Beacon light column
      const beaconGeo = new THREE.CylinderGeometry(0.1, 0.1, 8, 16);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.15,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.y = 4;
      group.add(beacon);

      scene.add(group);
      return group;
    };

    const depotGroup = createStationBase(ROUTE_NODES[0].position, '#2563eb');
    const warehouseBuilding = new THREE.Group();
    const mainWhGeo = new THREE.BoxGeometry(2.6, 2.0, 3.2);
    const mainWhMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2 });
    const mainWh = new THREE.Mesh(mainWhGeo, mainWhMat);
    mainWh.position.y = 1.4;
    mainWh.castShadow = true;
    warehouseBuilding.add(mainWh);

    const roofGeo = new THREE.ConeGeometry(2.2, 0.8, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#2563eb', roughness: 0.3 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 2.8;
    roof.rotation.y = Math.PI / 4;
    warehouseBuilding.add(roof);

    // Radar dish on roof
    const radarDishGeo = new THREE.CylinderGeometry(0.5, 0.1, 0.15, 16);
    const radarDishMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', metalness: 0.8 });
    const radarDish = new THREE.Mesh(radarDishGeo, radarDishMat);
    radarDish.position.set(0, 3.4, 0);
    warehouseBuilding.add(radarDish);

    depotGroup.add(warehouseBuilding);
    animatedObjects.push({
      mesh: radarDish,
      update: (t) => {
        radarDish.rotation.y = t * 1.5;
      },
    });

    const picklistGroup = createStationBase(ROUTE_NODES[1].position, '#4f46e5');
    const terminalGeo = new THREE.BoxGeometry(1.6, 2.4, 0.4);
    const terminalMat = new THREE.MeshStandardMaterial({ color: '#1e1b4b', roughness: 0.1 });
    const terminalMesh = new THREE.Mesh(terminalGeo, terminalMat);
    terminalMesh.position.y = 1.6;
    terminalMesh.castShadow = true;
    picklistGroup.add(terminalMesh);

    // Holographic screen
    const screenGeo = new THREE.PlaneGeometry(1.3, 1.8);
    const screenMat = new THREE.MeshBasicMaterial({ color: '#818cf8', transparent: true, opacity: 0.85 });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0, 1.6, 0.22);
    picklistGroup.add(screenMesh);

    // Floating document particles
    const docGeo = new THREE.PlaneGeometry(0.6, 0.8);
    const docMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, side: THREE.DoubleSide });
    const doc1 = new THREE.Mesh(docGeo, docMat);
    doc1.position.set(-1.0, 2.5, 0.5);
    picklistGroup.add(doc1);

    animatedObjects.push({
      mesh: doc1,
      update: (t) => {
        doc1.position.y = 2.5 + Math.sin(t * 2.5) * 0.25;
        doc1.rotation.y = Math.sin(t * 1.5) * 0.3;
      },
    });

    const dispatchGroup = createStationBase(ROUTE_NODES[2].position, '#0284c7');
    const towerGeo = new THREE.CylinderGeometry(0.6, 1.1, 3.2, 16);
    const towerMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2, metalness: 0.3 });
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.y = 2.0;
    tower.castShadow = true;
    dispatchGroup.add(tower);

    // Glowing satellite ring
    const satRingGeo = new THREE.TorusGeometry(1.4, 0.06, 16, 32);
    const satRingMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
    const satRing = new THREE.Mesh(satRingGeo, satRingMat);
    satRing.position.y = 2.8;
    satRing.rotation.x = Math.PI / 3;
    dispatchGroup.add(satRing);

    animatedObjects.push({
      mesh: satRing,
      update: (t) => {
        satRing.rotation.z = t * 1.8;
      },
    });

    const retailGroup = createStationBase(ROUTE_NODES[3].position, '#059669');
    const storeBuildingGeo = new THREE.BoxGeometry(2.8, 1.8, 2.2);
    const storeBuildingMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
    const storeMesh = new THREE.Mesh(storeBuildingGeo, storeBuildingMat);
    storeMesh.position.y = 1.3;
    storeMesh.castShadow = true;
    retailGroup.add(storeMesh);

    // Store Awning
    const awningGeo = new THREE.BoxGeometry(2.9, 0.2, 0.9);
    const awningMat = new THREE.MeshStandardMaterial({ color: '#10b981', roughness: 0.2 });
    const awning = new THREE.Mesh(awningGeo, awningMat);
    awning.position.set(0, 1.9, 1.3);
    awning.rotation.x = 0.2;
    retailGroup.add(awning);

    // Floating checkmark badge
    const checkBadgeGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const checkBadgeMat = new THREE.MeshStandardMaterial({ color: '#10b981', emissive: '#059669', emissiveIntensity: 0.6 });
    const checkBadge = new THREE.Mesh(checkBadgeGeo, checkBadgeMat);
    checkBadge.position.set(0, 3.0, 0);
    retailGroup.add(checkBadge);

    animatedObjects.push({
      mesh: checkBadge,
      update: (t) => {
        checkBadge.position.y = 3.0 + Math.sin(t * 3) * 0.2;
        checkBadge.rotation.y = t * 2;
      },
    });

    const paymentGroup = createStationBase(ROUTE_NODES[4].position, '#d97706');
    const posGeo = new THREE.BoxGeometry(1.2, 1.8, 1.6);
    const posMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2 });
    const posMesh = new THREE.Mesh(posGeo, posMat);
    posMesh.position.y = 1.3;
    posMesh.castShadow = true;
    paymentGroup.add(posMesh);

    // Gold floating rupee coin
    const coinGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.12, 32);
    const coinMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      metalness: 0.85,
      roughness: 0.15,
      emissive: '#d97706',
      emissiveIntensity: 0.4,
    });
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.position.set(0, 2.7, 0);
    coin.rotation.x = Math.PI / 2;
    paymentGroup.add(coin);

    animatedObjects.push({
      mesh: coin,
      update: (t) => {
        coin.rotation.z = t * 2.2;
        coin.position.y = 2.7 + Math.sin(t * 2.8) * 0.18;
      },
    });

    const intelGroup = createStationBase(ROUTE_NODES[5].position, '#7c3aed');
    const pillarGeo = new THREE.CylinderGeometry(0.7, 0.7, 3.2, 24);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.1,
      metalness: 0.2,
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = 2.0;
    pillar.castShadow = true;
    intelGroup.add(pillar);

    // Glowing data rings
    const ring1Geo = new THREE.TorusGeometry(1.1, 0.05, 16, 32);
    const ring1Mat = new THREE.MeshBasicMaterial({ color: '#a855f7' });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.position.y = 2.2;
    ring1.rotation.x = Math.PI / 2.5;
    intelGroup.add(ring1);

    const ring2 = ring1.clone();
    ring2.position.y = 2.8;
    ring2.rotation.x = -Math.PI / 3;
    intelGroup.add(ring2);

    animatedObjects.push({
      mesh: ring1,
      update: (t) => {
        ring1.rotation.z = t * 1.6;
        ring2.rotation.z = -t * 2.0;
      },
    });

    // ── 6. THE SMART ELECTRIC DELIVERY VAN ──────────────────────────────────
    const vanGroup = new THREE.Group();

    // Van Body
    const bodyGeo = new THREE.BoxGeometry(1.6, 1.1, 2.6);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.15,
      metalness: 0.1,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.85;
    body.castShadow = true;
    vanGroup.add(body);

    // Cabin windshield
    const windGeo = new THREE.BoxGeometry(1.45, 0.7, 0.8);
    const windMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.1,
      metalness: 0.9,
    });
    const windshield = new THREE.Mesh(windGeo, windMat);
    windshield.position.set(0, 0.95, 0.95);
    vanGroup.add(windshield);

    // Blue branding stripe
    const stripeGeo = new THREE.BoxGeometry(1.62, 0.25, 2.4);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: '#2563eb',
      roughness: 0.2,
      emissive: '#1d4ed8',
      emissiveIntensity: 0.4,
    });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 0.8;
    vanGroup.add(stripe);

    // Headlights
    const lightGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const lightMat = new THREE.MeshBasicMaterial({ color: '#67e8f9' });
    const hlLeft = new THREE.Mesh(lightGeo, lightMat);
    hlLeft.position.set(0.55, 0.6, 1.32);
    const hlRight = hlLeft.clone();
    hlRight.position.x = -0.55;
    vanGroup.add(hlLeft);
    vanGroup.add(hlRight);

    // 4 Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.25, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.8 });
    const w1 = new THREE.Mesh(wheelGeo, wheelMat);
    w1.rotation.z = Math.PI / 2;
    w1.position.set(0.85, 0.3, 0.8);
    const w2 = w1.clone();
    w2.position.set(-0.85, 0.3, 0.8);
    const w3 = w1.clone();
    w3.position.set(0.85, 0.3, -0.8);
    const w4 = w1.clone();
    w4.position.set(-0.85, 0.3, -0.8);
    vanGroup.add(w1);
    vanGroup.add(w2);
    vanGroup.add(w3);
    vanGroup.add(w4);

    scene.add(vanGroup);

    // ── 7. FLOATING GLOW PARTICLES (SHIMMER) ───────────────────────────────
    const particleCount = 80;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePositions[i] = (Math.random() - 0.5) * 50;
      particlePositions[i + 1] = Math.random() * 12 + 1;
      particlePositions[i + 2] = (Math.random() - 0.5) * 50;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: '#60a5fa',
      size: 0.35,
      transparent: true,
      opacity: 0.6,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // ── 8. INTERACTIVE MOUSE PARALLAX & ANIMATION LOOP ─────────────────────
    let mouseX = 0;
    let mouseY = 0;

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    window.addEventListener('mousemove', onMouseMove);

    let vanProgress = 0;
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsedTime = clock.getElapsedTime();

      // Update station animations
      animatedObjects.forEach((obj) => obj.update(elapsedTime));

      // Shimmering particles slow float
      particles.rotation.y = elapsedTime * 0.03;

      // Animate Van along spline
      if (!isReducedMotion) {
        vanProgress = (vanProgress + delta * 0.07) % 1.0;
        const currentPos = curve.getPointAt(vanProgress);
        const nextPos = curve.getPointAt((vanProgress + 0.01) % 1.0);

        vanGroup.position.copy(currentPos);
        vanGroup.position.y += 0.25;
        vanGroup.lookAt(nextPos.x, vanGroup.position.y, nextPos.z);
      }

      // Smooth camera interpolation based on active step node
      const currentNode = ROUTE_NODES[activeStepRef.current] || ROUTE_NODES[0];
      const targetPos = new THREE.Vector3(
        currentNode.position[0] * 0.4 + mouseX * 2.5,
        24 + mouseY * 1.5,
        currentNode.position[2] * 0.4 + 32
      );
      const targetLook = new THREE.Vector3(
        currentNode.position[0] * 0.6,
        1.5,
        currentNode.position[2] * 0.6
      );

      camera.position.lerp(targetPos, 0.04);
      cameraTarget.lerp(targetLook, 0.04);
      camera.lookAt(cameraTarget);

      renderer.render(scene, camera);
    };

    animate();

    // ── 9. RESIZE HANDLER ──────────────────────────────────────────────────
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [isReducedMotion]);

  return <div ref={containerRef} className="w-full h-full relative cursor-grab active:cursor-grabbing" />;
}
