import * as THREE from 'three';

// 两张贴图由所有伞共用，调参重建时不重复加载。
const textureLoader = new THREE.TextureLoader();
const bambooTexture = textureLoader.load(new URL('../assets/textures/bamboo-rib.png', import.meta.url).href);
const woodTexture = textureLoader.load(new URL('../assets/textures/wood-handle.png', import.meta.url).href);
for (const texture of [bambooTexture, woodTexture]) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
}
// 保持纵向纤维沿圆柱长度方向，避免把整张竹纹挤进细杆周长。
bambooTexture.repeat.set(0.08, 1);
woodTexture.repeat.set(0.5, 1);

const canopyTextures = new Map();
function loadCanopyTexture(path) {
  if (path === null) return null;
  if (canopyTextures.has(path)) return canopyTextures.get(path);
  const texture = textureLoader.load(path, (loaded) => {
    // 透明纹样印在完整纸面上，透明处保留材质底色，不挖空纸面。
    const canvas = document.createElement('canvas');
    canvas.width = loaded.image.width;
    canvas.height = loaded.image.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(loaded.image, 0, 0);
    loaded.image = canvas;
    loaded.needsUpdate = true;
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  canopyTextures.set(path, texture);
  return texture;
}

// 由页面的 importmap 将 three 指向 Three.js 0.169.0。
export function createUmbrella(params = {}) {
  const {
    radius = 1,
    shaftLength = 1.6,
    canopyHeight = 0.35,
    canopyRise = 0.06,
    ribCount = 24,
    openAmount = 1,
    shaftRadius = 0.018,
    ribRadius = 0.009,
    stretcherRadius = 0.007,
    hubRadius = 0.045,
    hubHeight = 0.06,
    handleLength = 0.22,
    handleRadius = 0.045,
    transmission = 0.6,
    roughness = 0.65,
    canopyColor,
    canopyTexture = null,
    ribColor,
    colors = {},
  } = params;

  if (canopyTexture !== null && (typeof canopyTexture !== 'string' || !canopyTexture.trim())) {
    throw new TypeError('canopyTexture 必须是图片路径或 null');
  }

  const dimensions = {
    radius, shaftLength, canopyHeight, shaftRadius, ribRadius,
    stretcherRadius, hubRadius, hubHeight, handleLength, handleRadius,
  };
  for (const [name, value] of Object.entries(dimensions)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} 必须是大于 0 的有限数字`);
    }
  }
  if (!Number.isInteger(ribCount) || ribCount < 3) {
    throw new RangeError('ribCount 必须是至少为 3 的整数');
  }
  if (!Number.isFinite(canopyRise) || canopyRise < 0) {
    throw new RangeError('canopyRise 必须是大于或等于 0 的有限数字');
  }
  if (!Number.isFinite(openAmount) || openAmount < 0 || openAmount > 1) {
    throw new RangeError('openAmount 必须在 0 到 1 之间');
  }
  for (const [name, value] of Object.entries({ transmission, roughness })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${name} 必须在 0 到 1 之间`);
    }
  }

  const topY = shaftLength;
  const jointRadius = hubRadius * 0.9;
  const openSpan = radius - jointRadius;
  if (openSpan <= 0 || shaftRadius >= jointRadius) {
    throw new RangeError('伞面半径必须大于巢半径，巢必须能包住中棒');
  }
  const ribLength = Math.hypot(openSpan, canopyHeight);
  const halfRib = ribLength / 2;
  const openDistance = canopyHeight + openSpan * 0.25;
  const stretcherLength = Math.hypot(openSpan / 2, openDistance - canopyHeight / 2);
  const openAngle = Math.atan2(openSpan, canopyHeight);
  // 收拢时保留小角度，避免杆重合与伞面退化。
  const closedAngle = openAngle * 0.025;
  const closedDistance = halfRib * Math.cos(closedAngle)
    + Math.sqrt(stretcherLength ** 2 - (halfRib * Math.sin(closedAngle)) ** 2);
  if (topY - closedDistance - hubHeight / 2 <= handleLength) {
    throw new RangeError('中棒太短：收拢后的下巢必须位于手柄上方');
  }
  if (openDistance <= hubHeight) {
    throw new RangeError('上下巢间距太小，请减小巢的高度');
  }

  const umbrella = new THREE.Group();
  umbrella.name = 'umbrella';
  const ribs = new THREE.Group();
  ribs.name = 'ribs';
  const stretchers = new THREE.Group();
  stretchers.name = 'stretchers';

  const shaftMaterial = new THREE.MeshStandardMaterial({
    color: colors.shaft ?? '#80622e', roughness: 0.8,
  });
  const ribMaterial = new THREE.MeshStandardMaterial({
    color: ribColor ?? colors.ribs ?? '#ffffff', roughness: 0.85,
    map: bambooTexture,
  });
  const stretcherMaterial = new THREE.MeshStandardMaterial({
    color: colors.ribs ?? '#738052', roughness: 0.85,
  });
  const hubMaterial = new THREE.MeshStandardMaterial({
    color: colors.hubs ?? '#68502e', roughness: 0.8,
  });
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: colors.handle ?? '#ffffff', roughness: 0.75,
    map: woodTexture,
  });
  const canopyMaterial = new THREE.MeshPhysicalMaterial({
    color: canopyColor ?? colors.canopy ?? '#cba348',
    map: loadCanopyTexture(canopyTexture),
    transmission,
    roughness,
    metalness: 0,
    // 薄伞面使用物理透射，保持不透明度为 1。
    opacity: 1,
    thickness: 0,
    side: THREE.DoubleSide,
  });

  const up = new THREE.Vector3(0, 1, 0);
  function positionRod(mesh, start, end) {
    const direction = new THREE.Vector3().subVectors(end, start);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(up, direction.normalize());
  }

  function makeRod(name, start, end, rodRadius, material) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rodRadius, rodRadius, direction.length(), 12),
      material,
    );
    mesh.name = name;
    positionRod(mesh, start, end);
    return mesh;
  }

  const top = new THREE.Vector3(0, topY, 0);
  umbrella.add(makeRod('shaft', new THREE.Vector3(), top, shaftRadius, shaftMaterial));
  umbrella.add(makeRod(
    'handle', new THREE.Vector3(), new THREE.Vector3(0, handleLength, 0),
    handleRadius, handleMaterial,
  ));

  function makeHub(name, y) {
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(hubRadius * 0.8, hubRadius, hubHeight, 24),
      hubMaterial,
    );
    hub.name = name;
    hub.position.y = y;
    return hub;
  }
  const lowerHub = makeHub('lowerHub', topY - openDistance);
  umbrella.add(makeHub('upperHub', topY), lowerHub);

  const directions = [];
  for (let i = 0; i < ribCount; i += 1) {
    const angle = i * Math.PI * 2 / ribCount;
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    directions.push(direction);
    const joint = direction.clone().multiplyScalar(jointRadius);
    joint.y = topY;
    const tip = new THREE.Vector3(
      radius * Math.cos(angle), topY - canopyHeight, radius * Math.sin(angle),
    );
    ribs.add(makeRod(`rib-${i}`, joint, tip, ribRadius, ribMaterial));
    const midpoint = joint.clone().lerp(tip, 0.5);
    const lowerJoint = direction.clone().multiplyScalar(jointRadius);
    lowerJoint.y = topY - openDistance;
    stretchers.add(makeRod(
      `stretcher-${i}`, lowerJoint, midpoint, stretcherRadius, stretcherMaterial,
    ));
  }
  umbrella.add(ribs, stretchers);

  const positions = [];
  const indices = [];
  const radialSteps = 16;
  const panelSteps = 8;

  for (let panel = 0; panel < ribCount; panel += 1) {
    const center = positions.length / 3;
    positions.push(0, 0, 0);
    const firstRow = positions.length / 3;

    for (let row = 0; row <= radialSteps; row += 1) {
      for (let column = 0; column <= panelSteps; column += 1) {
        positions.push(0, 0, 0);
      }
    }

    for (let column = 0; column < panelSteps; column += 1) {
      indices.push(center, firstRow + column + 1, firstRow + column);
    }
    for (let row = 0; row < radialSteps; row += 1) {
      for (let column = 0; column < panelSteps; column += 1) {
        const a = firstRow + row * (panelSteps + 1) + column;
        const b = a + 1;
        const c = a + panelSteps + 1;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const canopyGeometry = new THREE.BufferGeometry();
  canopyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  canopyGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  canopyGeometry.setIndex(indices);
  const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
  canopy.name = 'canopy';
  umbrella.add(canopy);

  // 每次更新复用已有零件和网格，不重新创建材质或几何体。
  function setOpenAmount(amount) {
    if (!Number.isFinite(amount) || amount < 0 || amount > 1) {
      throw new RangeError('openAmount 必须在 0 到 1 之间');
    }
    const distance = THREE.MathUtils.lerp(closedDistance, openDistance, amount);
    // 上巢、下巢、伞骨中点构成三角形；两根杆的长度始终不变。
    const cosine = THREE.MathUtils.clamp(
      (halfRib ** 2 + distance ** 2 - stretcherLength ** 2) / (2 * halfRib * distance),
      -1, 1,
    );
    const sine = Math.sqrt(Math.max(0, 1 - cosine ** 2));
    const span = ribLength * sine;
    const drop = ribLength * cosine;
    lowerHub.position.y = topY - distance;

    for (let i = 0; i < ribCount; i += 1) {
      const joint = directions[i].clone().multiplyScalar(jointRadius);
      joint.y = topY;
      const tip = directions[i].clone().multiplyScalar(jointRadius + span);
      tip.y = topY - drop;
      const midpoint = joint.clone().lerp(tip, 0.5);
      const lowerJoint = directions[i].clone().multiplyScalar(jointRadius);
      lowerJoint.y = lowerHub.position.y;
      positionRod(ribs.children[i], joint, tip);
      positionRod(stretchers.children[i], lowerJoint, midpoint);
    }

    const halfPanel = Math.PI / ribCount;
    const panelCosine = Math.cos(halfPanel);
    const clearance = (2 * Math.max(ribRadius, stretcherRadius) + 0.002) / panelCosine;
    const normalY = span * panelCosine / Math.hypot(drop, span * panelCosine);
    const fabric = canopyGeometry.attributes.position;
    let vertex = 0;

    for (let panel = 0; panel < ribCount; panel += 1) {
      const left = directions[panel];
      const right = directions[(panel + 1) % ribCount];
      fabric.setXYZ(vertex++, 0, topY + hubHeight / 2 + clearance, 0);
      for (let row = 0; row <= radialSteps; row += 1) {
        const t = row / radialSteps;
        const r = hubRadius + span * t + clearance * cosine;
        for (let column = 0; column <= panelSteps; column += 1) {
          const u = column / panelSteps;
          const x = r * THREE.MathUtils.lerp(left.x, right.x, u);
          const z = r * THREE.MathUtils.lerp(left.z, right.z, u);
          const edgeDistance = Math.min(
            Math.abs(left.x * z - left.z * x),
            Math.abs(right.x * z - right.z * x),
          );
          const requestedSag = canopyRise * (span / openSpan)
            * Math.sin(Math.PI * t) * Math.sin(Math.PI * u) ** 2;
          // 靠近杆时限制弧垂斜率，为有粗细的伞骨、撑骨保留安全间隙。
          const sag = Math.min(requestedSag, edgeDistance * 0.5 / normalY);
          fabric.setXYZ(
            vertex++, x, topY - drop * t + hubHeight / 2 + clearance * sine - sag, z,
          );
        }
      }
    }
    fabric.needsUpdate = true;

    // 使用当前伞面的水平距离，避免收拢后仍按完全张开的半径取样。
    let outerRadius = 0;
    for (let i = 0; i < fabric.count; i += 1) {
      outerRadius = Math.max(outerRadius, Math.hypot(fabric.getX(i), fabric.getZ(i)));
    }
    const uv = canopyGeometry.attributes.uv;
    const fullTurn = Math.PI * 2;
    for (let i = 0; i < fabric.count; i += 1) {
      const x = fabric.getX(i);
      const z = fabric.getZ(i);
      const horizontalDistance = Math.hypot(x, z);
      if (horizontalDistance === 0) {
        uv.setXY(i, 0.5, 0.5);
        continue;
      }
      const normalizedRadius = THREE.MathUtils.clamp(horizontalDistance / outerRadius, 0, 1);
      const normalizedAngle = ((Math.atan2(z, x) + fullTurn) % fullTurn) / fullTurn;
      const angle = normalizedAngle * fullTurn;
      // 圆形平面图须转回圆盘坐标，不能直接把角度和半径当作 u、v。
      uv.setXY(i,
        0.5 + 0.5 * normalizedRadius * Math.cos(angle),
        0.5 - 0.5 * normalizedRadius * Math.sin(angle),
      );
    }
    uv.needsUpdate = true;
    canopyGeometry.computeVertexNormals();
    canopyGeometry.computeBoundingBox();
    canopyGeometry.computeBoundingSphere();
    umbrella.userData.openAmount = amount;
  }

  umbrella.userData.setOpenAmount = setOpenAmount;
  setOpenAmount(openAmount);

  return umbrella;
}
