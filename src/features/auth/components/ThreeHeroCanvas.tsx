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
}

export const ROUTE_NODES: NodeData[] = [
  { id: 'warehouse', name: 'Sanghavi Main Depot', sub: 'Warehouse & Inventory', stepIndex: 0, tPos: 0.02, position: [-14, 0, -6] },
  { id: 'picklist', name: 'SAP Picklist Station', sub: 'Digital Order Dispatch', stepIndex: 1, tPos: 0.20, position: [-6, 0, 8] },
  { id: 'route', name: 'Smart Delivery Route', sub: 'Live Driver GPS', stepIndex: 2, tPos: 0.40, position: [6, 0, 10] },
  { id: 'retail', name: 'Supermarket Drop-off', sub: 'Colgate Delivery', stepIndex: 3, tPos: 0.60, position: [14, 0, 2] },
  { id: 'payments', name: 'Instant Payment Hub', sub: 'Cash & UPI Clearance', stepIndex: 4, tPos: 0.80, position: [8, 0, -10] },
  { id: 'analytics', name: 'Executive Intelligence', sub: 'Real-time Reports', stepIndex: 5, tPos: 0.95, position: [-4, 0, -12] },
];

export function ThreeHeroCanvas({ activeStep, onStepChange: _onStepChange, isReducedMotion = false }: ThreeHeroCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeStepRef = useRef(activeStep);
  activeStepRef.current = activeStep;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── 1. SCENE, FOG & CAMERA SETUP ───────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f8fafc');
    scene.fog = new THREE.FogExp2('#f8fafc', 0.010);

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Isometric perspective framing
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 300);
    const initialCamPos = new THREE.Vector3(0, 32, 42);
    camera.position.copy(initialCamPos);
    const cameraTarget = new THREE.Vector3(0, 0, 0);
    camera.lookAt(cameraTarget);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    container.appendChild(renderer.domElement);

    // ── 2. LIGHTING ────────────────────────────────────────────────────────
    const hemiLight = new THREE.HemisphereLight('#ffffff', '#cbd5e1', 1.0);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight('#ffffff', 1.1);
    scene.add(ambientLight);

    const mainSun = new THREE.DirectionalLight('#fffbeb', 2.2);
    mainSun.position.set(30, 45, 25);
    mainSun.castShadow = true;
    mainSun.shadow.mapSize.width = 2048;
    mainSun.shadow.mapSize.height = 2048;
    mainSun.shadow.camera.near = 1;
    mainSun.shadow.camera.far = 150;
    const d = 35;
    mainSun.shadow.camera.left = -d;
    mainSun.shadow.camera.right = d;
    mainSun.shadow.camera.top = d;
    mainSun.shadow.camera.bottom = -d;
    mainSun.shadow.bias = -0.0003;
    scene.add(mainSun);

    const fillLight = new THREE.DirectionalLight('#93c5fd', 0.6);
    fillLight.position.set(-25, 25, -25);
    scene.add(fillLight);

    // ── 3. GROUND PLATFORM & GRID ──────────────────────────────────────────
    const groundGeo = new THREE.PlaneGeometry(140, 140);
    const groundMat = new THREE.MeshStandardMaterial({
      color: '#f1f5f9',
      roughness: 0.9,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(120, 60, '#cbd5e1', '#e2e8f0');
    grid.position.y = 0.01;
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    // ── 4. CURVED ASPHALT ROAD MESH & DASHED CENTER LINE ───────────────────
    const routeControlPoints = [
      new THREE.Vector3(-14, 0.1, -6),   // Warehouse
      new THREE.Vector3(-10, 0.1, 2),
      new THREE.Vector3(-6, 0.1, 8),     // Picklist Station
      new THREE.Vector3(0, 0.1, 11),
      new THREE.Vector3(6, 0.1, 10),     // Delivery Route
      new THREE.Vector3(12, 0.1, 6),
      new THREE.Vector3(14, 0.1, 2),     // Supermarket Store
      new THREE.Vector3(13, 0.1, -5),
      new THREE.Vector3(8, 0.1, -10),    // Payments Hub
      new THREE.Vector3(1, 0.1, -12),
      new THREE.Vector3(-4, 0.1, -12),   // Analytics Skyscraper
      new THREE.Vector3(-10, 0.1, -10),
    ];

    const curve = new THREE.CatmullRomCurve3(routeControlPoints, true, 'centripetal', 0.4);
    const points = curve.getPoints(240);
    const numPoints = points.length;

    // Helper: Build asphalt road ribbon geometry
    const buildRoadRibbon = (width: number, heightOffset: number, color: string, roughness = 0.6) => {
      const geo = new THREE.BufferGeometry();
      const verts: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (let i = 0; i < numPoints; i++) {
        const p = points[i];
        const u = i / (numPoints - 1);
        const tangent = curve.getTangentAt(u).normalize();
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

        const left = new THREE.Vector3().copy(p).addScaledVector(normal, width / 2);
        const right = new THREE.Vector3().copy(p).addScaledVector(normal, -width / 2);

        verts.push(left.x, heightOffset, left.z);
        verts.push(right.x, heightOffset, right.z);

        uvs.push(0, u * 25);
        uvs.push(1, u * 25);

        if (i < numPoints - 1) {
          const r1 = i * 2;
          const r2 = (i + 1) * 2;
          indices.push(r1, r1 + 1, r2);
          indices.push(r1 + 1, r2 + 1, r2);
        }
      }

      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      return mesh;
    };

    // Concrete curb base (width 2.6)
    const curbMesh = buildRoadRibbon(2.6, 0.02, '#e2e8f0', 0.8);
    scene.add(curbMesh);

    // Dark asphalt road ribbon (width 2.1)
    const roadMesh = buildRoadRibbon(2.1, 0.04, '#1e293b', 0.5);
    scene.add(roadMesh);

    // Animated yellow dashed line down road center
    const dashedLineVerts: number[] = [];
    for (let i = 0; i < numPoints; i++) {
      dashedLineVerts.push(points[i].x, 0.06, points[i].z);
    }
    const dashedGeo = new THREE.BufferGeometry();
    dashedGeo.setAttribute('position', new THREE.Float32BufferAttribute(dashedLineVerts, 3));
    const dashedMat = new THREE.LineDashedMaterial({
      color: '#f59e0b',
      dashSize: 0.7,
      gapSize: 0.4,
    });
    const dashedLine = new THREE.Line(dashedGeo, dashedMat);
    dashedLine.computeLineDistances();
    scene.add(dashedLine);

    // ── 5. DETAILED LOGISTICS BUILDINGS & STATIONS ─────────────────────────

    const createMat = (color: string, roughness = 0.4, metalness = 0.1) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness });

    const matWhite = createMat('#ffffff', 0.25);
    const matDarkGray = createMat('#334155', 0.5);
    const matBlue = createMat('#2563eb', 0.3, 0.3);
    const matGreen = createMat('#10b981', 0.3, 0.3);
    const matGlass = new THREE.MeshPhysicalMaterial({
      color: '#93c5fd',
      transparent: true,
      opacity: 0.6,
      roughness: 0.1,
      metalness: 0.9,
    });

    // WAREHOUSE DEPOT (Sanghavi Central Hub)
    const warehouseGroup = new THREE.Group();
    warehouseGroup.position.set(-14, 0, -6);

    const whBody = new THREE.Mesh(new THREE.BoxGeometry(7, 4.2, 9), matWhite);
    whBody.position.set(0, 2.1, 0);
    whBody.castShadow = true;
    whBody.receiveShadow = true;
    warehouseGroup.add(whBody);

    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.4, 9.4), matBlue);
    roofTrim.position.set(0, 4.3, 0);
    roofTrim.castShadow = true;
    warehouseGroup.add(roofTrim);

    for (let r = -3; r <= 3; r += 2) {
      const skylight = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 8.6), matDarkGray);
      skylight.position.set(r, 4.6, 0);
      skylight.rotation.z = 0.2;
      skylight.castShadow = true;
      warehouseGroup.add(skylight);
    }

    for (let b = -2.4; b <= 2.4; b += 2.4) {
      const bayDoor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.4, 0.15), matDarkGray);
      bayDoor.position.set(b, 1.2, 4.55);
      warehouseGroup.add(bayDoor);
    }

    const dockPlatform = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.4, 2.2), createMat('#cbd5e1', 0.8));
    dockPlatform.position.set(0, 0.2, 5.4);
    dockPlatform.receiveShadow = true;
    warehouseGroup.add(dockPlatform);

    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.8, 0.2), matBlue);
    signBoard.position.set(0, 3.5, 4.6);
    warehouseGroup.add(signBoard);

    scene.add(warehouseGroup);

    // SAP PICKLIST KIOSK
    const picklistGroup = new THREE.Group();
    picklistGroup.position.set(-6, 0, 8);

    const kioskBase = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 16), matDarkGray);
    kioskBase.position.y = 1.5;
    kioskBase.castShadow = true;
    picklistGroup.add(kioskBase);

    const kioskHead = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 0.2), matBlue);
    kioskHead.position.set(0, 2.6, 0);
    kioskHead.castShadow = true;
    picklistGroup.add(kioskHead);

    const holoScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), matGlass);
    holoScreen.position.set(0, 2.6, 0.12);
    picklistGroup.add(holoScreen);

    scene.add(picklistGroup);

    // SUPERMARKET RETAIL STORE
    const storeGroup = new THREE.Group();
    storeGroup.position.set(14, 0, 2);

    const storeBody = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.8, 5.5), matWhite);
    storeBody.position.set(0, 1.9, 0);
    storeBody.castShadow = true;
    storeBody.receiveShadow = true;
    storeGroup.add(storeBody);

    const awning = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.35, 1.6), matGreen);
    awning.position.set(0, 2.9, 3.0);
    awning.rotation.x = 0.2;
    awning.castShadow = true;
    storeGroup.add(awning);

    const storeWindow = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.0), matGlass);
    storeWindow.position.set(0, 1.5, 2.76);
    storeGroup.add(storeWindow);

    const storeSign = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.7, 0.15), matBlue);
    storeSign.position.set(0, 3.4, 2.8);
    storeGroup.add(storeSign);

    scene.add(storeGroup);

    // PAYMENTS HUB
    const paymentGroup = new THREE.Group();
    paymentGroup.position.set(8, 0, -10);

    const payBuilding = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 5.2, 16), matWhite);
    payBuilding.position.y = 2.6;
    payBuilding.castShadow = true;
    payBuilding.receiveShadow = true;
    paymentGroup.add(payBuilding);

    const payRing = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 16, 32), matGreen);
    payRing.rotation.x = Math.PI / 2;
    payRing.position.y = 4.4;
    paymentGroup.add(payRing);

    scene.add(paymentGroup);

    // ANALYTICS SKYSCRAPER
    const analyticsGroup = new THREE.Group();
    analyticsGroup.position.set(-4, 0, -12);

    const anaTower = new THREE.Mesh(new THREE.BoxGeometry(4.8, 7.5, 4.8), matGlass);
    anaTower.position.y = 3.75;
    anaTower.castShadow = true;
    anaTower.receiveShadow = true;
    analyticsGroup.add(anaTower);

    const anaRoof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.4, 5.2), matBlue);
    anaRoof.position.y = 7.7;
    analyticsGroup.add(anaRoof);

    scene.add(analyticsGroup);

    // ── 6. ENVIRONMENT TREES & STATION RINGS ──────────────────────────────
    const treeGeo = new THREE.ConeGeometry(1.2, 2.8, 8);
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.2);
    const foliageMat = createMat('#15803d', 0.7);
    const trunkMat = createMat('#78350f', 0.9);

    const treePositions: [number, number][] = [
      [-18, 4], [-12, 12], [2, 14], [18, 10], [16, -6], [2, -16], [-10, -16]
    ];

    treePositions.forEach(([tx, tz]) => {
      const treeGroup = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.6;
      trunk.castShadow = true;
      const foliage = new THREE.Mesh(treeGeo, foliageMat);
      foliage.position.y = 2.0;
      foliage.castShadow = true;
      treeGroup.add(trunk);
      treeGroup.add(foliage);
      treeGroup.position.set(tx, 0, tz);
      scene.add(treeGroup);
    });

    // Station Checkpoint Ground Rings
    const nodeRingMeshes: THREE.Mesh[] = [];
    ROUTE_NODES.forEach((node) => {
      const ringGeo = new THREE.RingGeometry(1.8, 2.2, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: '#2563eb',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(node.position[0], 0.05, node.position[2]);
      scene.add(ring);
      nodeRingMeshes.push(ring);
    });

    // ── 7. DETAILED 3D HERO DELIVERY TRUCK ─────────────────────────────────
    const truckGroup = new THREE.Group();

    // Chassis frame
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 4.0), createMat('#0f172a', 0.8));
    chassis.position.y = 0.45;
    chassis.castShadow = true;
    truckGroup.add(chassis);

    // Yellow Aerodynamic Cabin matching user logo
    const cabMat = createMat('#eab308', 0.3, 0.2);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.35, 1.3), cabMat);
    cab.position.set(0, 1.2, 1.15);
    cab.castShadow = true;
    truckGroup.add(cab);

    // Front Bumper
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.3, 0.3), matBlue);
    bumper.position.set(0, 0.45, 1.8);
    truckGroup.add(bumper);

    // Windshield
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.7), matGlass);
    windshield.position.set(0, 1.4, 1.81);
    truckGroup.add(windshield);

    // Dark Navy Cargo Container matching user logo
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.6, 2.8), createMat('#1e293b', 0.3));
    cargo.position.set(0, 1.35, -0.75);
    cargo.castShadow = true;
    truckGroup.add(cargo);

    // Orange Brand Stripe
    const stripeOrange = new THREE.Mesh(new THREE.BoxGeometry(1.67, 0.3, 2.82), createMat('#f97316', 0.3));
    stripeOrange.position.set(0, 0.85, -0.75);
    truckGroup.add(stripeOrange);

    // Emerald Accent Stripe
    const stripeGreen = new THREE.Mesh(new THREE.BoxGeometry(1.67, 0.2, 2.82), matGreen);
    stripeGreen.position.set(0, 1.35, -0.75);
    truckGroup.add(stripeGreen);

    // LED Headlights
    const headlightGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.1);
    const headlightMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
    const headlightL = new THREE.Mesh(headlightGeo, headlightMat);
    headlightL.rotation.x = Math.PI / 2;
    headlightL.position.set(-0.55, 0.75, 1.81);
    const headlightR = headlightL.clone();
    headlightR.position.set(0.55, 0.75, 1.81);
    truckGroup.add(headlightL);
    truckGroup.add(headlightR);

    // Headlight Spot beam
    const truckSpot = new THREE.SpotLight('#ffffff', 3.5, 16, Math.PI / 6, 0.5);
    truckSpot.position.set(0, 0.8, 1.8);
    truckSpot.target.position.set(0, 0, 8);
    truckGroup.add(truckSpot);
    truckGroup.add(truckSpot.target);

    // 4 Wheels
    const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 24);
    const tireMat = createMat('#0f172a', 0.9);
    const rimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.3, 12);
    const rimMat = createMat('#e2e8f0', 0.2, 0.8);

    const wheels: THREE.Group[] = [];
    const wheelPositions: [number, number, number][] = [
      [-0.85, 0.34, 1.15],
      [0.85, 0.34, 1.15],
      [-0.85, 0.34, -1.05],
      [0.85, 0.34, -1.05],
    ];

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.z = Math.PI / 2;
      wGroup.add(tire);
      wGroup.add(rim);
      wGroup.position.set(...pos);
      truckGroup.add(wGroup);
      wheels.push(wGroup);
    });

    scene.add(truckGroup);

    // Package Cartons sliding along conveyer
    const packageCount = 4;
    const packageGeo = new THREE.BoxGeometry(0.45, 0.4, 0.45);
    const packageMat = createMat('#fbbf24', 0.5);
    const packageBoxes: THREE.Mesh[] = [];

    for (let p = 0; p < packageCount; p++) {
      const pkg = new THREE.Mesh(packageGeo, packageMat);
      pkg.castShadow = true;
      scene.add(pkg);
      packageBoxes.push(pkg);
    }

    // ── 8. MOUSE PARALLAX HANDLER ─────────────────────────────────────────
    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      targetMouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      targetMouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };

    window.addEventListener('mousemove', handleMouseMove);

    // ── 9. ANIMATION LOOP ──────────────────────────────────────────────────
    let animationFrameId: number;
    let progressT = 0;
    const speed = isReducedMotion ? 0.0003 : 0.0011;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      progressT = (progressT + speed) % 1;

      const currentPos = curve.getPointAt(progressT);
      const tangent = curve.getTangentAt(progressT).normalize();

      truckGroup.position.copy(currentPos);
      truckGroup.position.y = 0.12;

      const lookTarget = currentPos.clone().add(tangent);
      truckGroup.lookAt(lookTarget);

      const curvature = tangent.x * 0.12;
      truckGroup.rotation.z = -curvature;
      truckGroup.position.y += Math.sin(clock.getElapsedTime() * 10) * 0.012;

      wheels.forEach((w) => {
        w.children[0].rotation.x += delta * 14;
        w.children[1].rotation.x += delta * 14;
      });

      packageBoxes.forEach((pkg, idx) => {
        const pkgT = (progressT + idx * 0.1) % 1;
        const pkgPos = curve.getPointAt(pkgT);
        pkg.position.set(pkgPos.x, 0.45 + Math.sin(pkgT * Math.PI * 6) * 0.04, pkgPos.z);
        pkg.rotation.y += 0.02;
      });

      ROUTE_NODES.forEach((node, i) => {
        const dist = Math.abs(progressT - node.tPos);
        const cyclicDist = Math.min(dist, 1 - dist);

        const isNear = cyclicDist < 0.06;
        const ringMat = nodeRingMeshes[i].material as THREE.MeshBasicMaterial;
        ringMat.opacity = THREE.MathUtils.lerp(ringMat.opacity, isNear ? 0.95 : 0.35, 0.1);
        ringMat.color.set(isNear ? '#10b981' : activeStepRef.current === i ? '#2563eb' : '#94a3b8');
      });

      mouseX += (targetMouseX - mouseX) * 0.04;
      mouseY += (targetMouseY - mouseY) * 0.04;

      const activeNode = ROUTE_NODES[activeStepRef.current] || ROUTE_NODES[0];
      const targetCamX = activeNode.position[0] * 0.3 + mouseX * 2.0;
      const targetCamZ = 38 + activeNode.position[2] * 0.2 + mouseY * 1.8;

      camera.position.x += (targetCamX - camera.position.x) * 0.03;
      camera.position.z += (targetCamZ - camera.position.z) * 0.03;
      camera.position.y += (32 - camera.position.y) * 0.03;

      cameraTarget.x += (activeNode.position[0] * 0.4 - cameraTarget.x) * 0.03;
      cameraTarget.z += (activeNode.position[2] * 0.4 - cameraTarget.z) * 0.03;
      camera.lookAt(cameraTarget);

      renderer.render(scene, camera);
    };

    animate();

    // ── 10. RESIZE HANDLER ─────────────────────────────────────────────────
    const handleResize = () => {
      if (!container) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // ── 11. CLEANUP ────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      resizeObserver.disconnect();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      curbMesh.geometry.dispose();
      roadMesh.geometry.dispose();
      dashedGeo.dispose();
      dashedMat.dispose();
    };
  }, [isReducedMotion]);

  return (
    <div className="relative w-full h-full min-h-[480px] lg:min-h-[540px] rounded-3xl overflow-hidden shadow-2xl border border-slate-200/80 bg-[#f8fafc]">
      <div ref={containerRef} className="w-full h-full absolute inset-0 cursor-grab active:cursor-grabbing" />

      {/* Floating Live Status Badge */}
      <div className="absolute top-5 left-5 z-20 px-4 py-2.5 rounded-2xl bg-white/90 backdrop-blur-md border border-slate-200 shadow-lg flex items-center gap-3">
        <div className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
        </div>
        <div>
          <div className="text-xs font-black tracking-wide text-slate-900 uppercase flex items-center gap-1.5">
            <span>Route #4 Active</span>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">Live 60 FPS</span>
          </div>
          <div className="text-[10px] text-slate-500 font-semibold">Sanghavi Hub → 18 Retail Stores</div>
        </div>
      </div>

      {/* Interactive Quick Step Selector Controls */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 px-3 py-2 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl flex items-center gap-1.5 max-w-[95%] overflow-x-auto scrollbar-none">
        {ROUTE_NODES.map((node) => {
          const isActive = activeStep === node.stepIndex;
          return (
            <button
              key={node.id}
              onClick={() => _onStepChange?.(node.stepIndex)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 scale-105'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-white' : 'bg-slate-400'}`} />
              <span>{node.name.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
