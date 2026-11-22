const geometryCache = new Map();

function isBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const faceCount = view.getUint32(80, true);
  const expectedLength = 84 + faceCount * 50;
  if (expectedLength === buffer.byteLength) return true;

  // Fallback check: inspect header/start for 'solid' vs non-ASCII bytes
  const bytes = new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength));
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0 || bytes[i] > 127) return true;
  }
  return false;
}

function parseBinarySTL(THREE, buffer) {
  const view = new DataView(buffer);
  const faces = view.getUint32(80, true);
  const positions = new Float32Array(faces * 9);
  const normals = new Float32Array(faces * 9);

  let offset = 84;
  let posIdx = 0;

  for (let i = 0; i < faces; i++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    for (let v = 0; v < 3; v++) {
      positions[posIdx] = view.getFloat32(offset, true);
      positions[posIdx + 1] = view.getFloat32(offset + 4, true);
      positions[posIdx + 2] = view.getFloat32(offset + 8, true);

      normals[posIdx] = nx;
      normals[posIdx + 1] = ny;
      normals[posIdx + 2] = nz;

      posIdx += 3;
      offset += 12;
    }

    offset += 2; // attribute byte count
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

function parseASCIISTL(THREE, buffer) {
  const text = new TextDecoder().decode(buffer);
  const vertexPattern =
    /vertex\s+([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s+([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s+([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;

  const verts = [];
  let match;
  while ((match = vertexPattern.exec(text)) !== null) {
    verts.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Parses a binary or ASCII STL ArrayBuffer into a centered, unit-normalized
 * THREE.BufferGeometry ready to render on a showcase card.
 */
export function parseSTL(THREE, buffer) {
  const geometry = isBinarySTL(buffer)
    ? parseBinarySTL(THREE, buffer)
    : parseASCIISTL(THREE, buffer);

  geometry.computeBoundingBox();
  if (geometry.boundingBox) {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    geometry.boundingBox.getSize(size);

    geometry.translate(-center.x, -center.y, -center.z);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const targetExtent = 1.18;
    const scale = targetExtent / maxDim;
    geometry.scale(scale, scale, scale);
  }

  // Ensure valid normals even if the STL had zeroed normals
  const normalAttr = geometry.getAttribute('normal');
  if (!normalAttr || normalAttr.count === 0) {
    geometry.computeVertexNormals();
  } else {
    let hasNonZero = false;
    for (let i = 0; i < Math.min(normalAttr.array.length, 27); i++) {
      if (normalAttr.array[i] !== 0) {
        hasNonZero = true;
        break;
      }
    }
    if (!hasNonZero) geometry.computeVertexNormals();
  }

  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Fetches and caches a normalized THREE.BufferGeometry from an .stl URL.
 */
export async function loadSTLGeometry(THREE, url) {
  if (geometryCache.has(url)) {
    return geometryCache.get(url);
  }

  const promise = fetch(url)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch STL (${res.status}): ${url}`);
      }
      return res.arrayBuffer();
    })
    .then((buffer) => parseSTL(THREE, buffer))
    .catch((err) => {
      geometryCache.delete(url);
      throw err;
    });

  geometryCache.set(url, promise);
  return promise;
}
