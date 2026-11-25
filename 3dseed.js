import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const container = document.getElementById("simulation");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(4, 3, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 2));
const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
directionalLight.position.set(5, 10, 5);
directionalLight.castShadow = true;
scene.add(directionalLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 1);
fillLight.position.set(-5, 3, -5);
scene.add(fillLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = true;
controls.enableZoom = true;
controls.zoomSpeed = 0.8;
controls.zoomToCursor = true;
controls.minDistance = 1;
controls.maxDistance = 150;

function setInitialCameraView(viewSize) {
    const distance = Math.max(viewSize, 1);
    const targetY = trampolineObject ? trampolineObject.position.y : groundY;
    camera.position.set(distance * 10, distance * 10, distance * 10);
    controls.target.set(0, targetY, 0);
    controls.update();
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let draggedObject = null;
let interactionObject = null;
let interactionActive = false;
let object2Materials = [];
let draggedSize = new THREE.Vector3();
let interactionSize = new THREE.Vector3();
let draggedVelocity = new THREE.Vector3();
let interactionVelocity = new THREE.Vector3();
let draggedAngularVelocity = new THREE.Vector3();
let interactionAngularVelocity = new THREE.Vector3();
let activeDragObject = null;
let activeDragOffset = new THREE.Vector3();
let activeDragDistance = 0;
const activeDragVelocity = new THREE.Vector3();
let activeDragLastUpdateTime = 0;
let groundY = 0;
let lastPhysicsTime = performance.now();
const pressedKeys = new Set();
const projectileCooldown = 0.5;
let lastLaunchTime = -projectileCooldown;
const physicsObjects = [];
let nextObjectId = 3;
let selectedObject = null;
let selectionBox = null;
let objectTemplate = null;
let object2Template = null;
let trampolineObject = null;
let trampolineSize = null;
const trampolineLegColliders = [];
let trampolineMembrane = null;
let boomTemplate = null;
let boomTemplateSize = null;
const explosions = [];
const pendingBooms = [];
const groundSize = 100;
const groundHalfSize = groundSize / 2;
const fallDeleteDepth = 12;
const gravityAcceleration = 9.8;
const terminalFallSpeed = 1000;
const trampolineBounceHeightRatio = 0.9;
let simulationRunning = false;
const hitboxMaterial = new THREE.LineBasicMaterial({ color: 0xff3344, depthTest: false });
const hitboxLines = new Map();
let audioContext = null;
let masterAudioGain = null;
let masterVolume = 0.5;
let explosionNoiseBuffer = null;
let audioUnavailableReported = false;

function getAudioContext() {
    if (audioContext) return audioContext;

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
        if (!audioUnavailableReported) {
            console.error("이 브라우저는 Web Audio API를 지원하지 않습니다.");
            audioUnavailableReported = true;
        }
        return null;
    }

    audioContext = new AudioContextConstructor();
    masterAudioGain = audioContext.createGain();
    masterAudioGain.gain.value = masterVolume;
    masterAudioGain.connect(audioContext.destination);
    explosionNoiseBuffer = audioContext.createBuffer(
        1,
        Math.ceil(audioContext.sampleRate * 0.7),
        audioContext.sampleRate
    );
    const noiseSamples = explosionNoiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseSamples.length; i++) {
        noiseSamples[i] = Math.random() * 2 - 1;
    }
    return audioContext;
}

function resumeAudio() {
    const context = getAudioContext();
    if (!context || context.state !== "suspended") return;
    context.resume().catch((error) => console.error("오디오 재생을 시작하지 못했습니다:", error));
}

function playTrampolineBounceSound(impactSpeed) {
    if (!audioContext || audioContext.state !== "running") return;

    const startTime = audioContext.currentTime;
    const intensity = THREE.MathUtils.clamp(impactSpeed / 10, 0.5, 1.4);
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(210 + intensity * 65, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(70 + intensity * 20, startTime + 0.24);
    volume.gain.setValueAtTime(0.0001, startTime);
    volume.gain.exponentialRampToValueAtTime(0.45 * intensity, startTime + 0.012);
    volume.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.28);
    oscillator.connect(volume);
    volume.connect(masterAudioGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.29);
}

function playExplosionSound() {
    if (!audioContext || audioContext.state !== "running" || !explosionNoiseBuffer) return;

    const startTime = audioContext.currentTime;
    const noise = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const noiseVolume = audioContext.createGain();
    noise.buffer = explosionNoiseBuffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, startTime);
    filter.frequency.exponentialRampToValueAtTime(140, startTime + 0.55);
    noiseVolume.gain.setValueAtTime(0.0001, startTime);
    noiseVolume.gain.exponentialRampToValueAtTime(0.28, startTime + 0.008);
    noiseVolume.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.58);
    noise.connect(filter);
    filter.connect(noiseVolume);
    noiseVolume.connect(masterAudioGain);
    noise.start(startTime);
    noise.stop(startTime + 0.6);

    const thump = audioContext.createOscillator();
    const thumpVolume = audioContext.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(96, startTime);
    thump.frequency.exponentialRampToValueAtTime(36, startTime + 0.42);
    thumpVolume.gain.setValueAtTime(0.0001, startTime);
    thumpVolume.gain.exponentialRampToValueAtTime(0.32, startTime + 0.01);
    thumpVolume.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.48);
    thump.connect(thumpVolume);
    thumpVolume.connect(masterAudioGain);
    thump.start(startTime);
    thump.stop(startTime + 0.5);
}

function getCenterOfMass(object) {
    object.updateWorldMatrix(true, true);
    const inverseWorld = object.matrixWorld.clone().invert();
    const localPosition = new THREE.Vector3();
    const sum = new THREE.Vector3();
    let totalWeight = 0;

    object.traverse((child) => {
        if (!child.isMesh || !child.geometry?.attributes?.position) return;
        const positions = child.geometry.attributes.position;
        const sampleStep = Math.max(1, Math.floor(positions.count / 300));

        for (let i = 0; i < positions.count; i += sampleStep) {
            localPosition.fromBufferAttribute(positions, i);
            localPosition.applyMatrix4(child.matrixWorld);
            localPosition.applyMatrix4(inverseWorld);
            sum.add(localPosition);
            totalWeight++;
        }
    });

    return totalWeight > 0 ? sum.multiplyScalar(1 / totalWeight) : new THREE.Vector3();
}

function getVerticalHalfExtent(object, size) {
    object.updateWorldMatrix(true, false);
    const quaternion = new THREE.Quaternion();
    object.getWorldQuaternion(quaternion);
    const rotation = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    const axes = [
        new THREE.Vector3(1, 0, 0).applyMatrix4(rotation),
        new THREE.Vector3(0, 1, 0).applyMatrix4(rotation),
        new THREE.Vector3(0, 0, 1).applyMatrix4(rotation)
    ];
    return size.x * 0.5 * Math.abs(axes[0].y)
        + size.y * 0.5 * Math.abs(axes[1].y)
        + size.z * 0.5 * Math.abs(axes[2].y);
}

function applyAngularRotation(object, angularVelocity, delta) {
    const angularSpeed = angularVelocity.length();
    if (angularSpeed < 1e-8) return;

    const rotation = new THREE.Quaternion().setFromAxisAngle(
        angularVelocity.clone().multiplyScalar(1 / angularSpeed),
        angularSpeed * delta
    );
    object.quaternion.premultiply(rotation).normalize();
}

function getInverseInertiaWorld(object, size, torque) {
    const quaternion = new THREE.Quaternion();
    object.getWorldQuaternion(quaternion);
    const localTorque = torque.clone().applyQuaternion(quaternion.clone().invert());
    const mass = Math.max(size.x * size.y * size.z, 0.01);
    const inertia = new THREE.Vector3(
        mass * (size.y * size.y + size.z * size.z) / 12,
        mass * (size.x * size.x + size.z * size.z) / 12,
        mass * (size.x * size.x + size.y * size.y) / 12
    );
    localTorque.set(
        localTorque.x / Math.max(inertia.x, 1e-4),
        localTorque.y / Math.max(inertia.y, 1e-4),
        localTorque.z / Math.max(inertia.z, 1e-4)
    );
    return localTorque.applyQuaternion(quaternion);
}

function getOBBCorners(object, size) {
    const quaternion = new THREE.Quaternion();
    const center = new THREE.Vector3();
    object.getWorldQuaternion(quaternion);
    object.getWorldPosition(center);
    const half = size.clone().multiplyScalar(0.5);
    const corners = [];

    for (const x of [-1, 1]) {
        for (const y of [-1, 1]) {
            for (const z of [-1, 1]) {
                corners.push(new THREE.Vector3(x * half.x, y * half.y, z * half.z)
                    .applyQuaternion(quaternion)
                    .add(center));
            }
        }
    }

    return corners;
}

function getOBBSupportPoint(object, size, direction) {
    const corners = getOBBCorners(object, size);
    const extreme = Math.max(...corners.map((corner) => corner.dot(direction)));
    const tolerance = Math.max(Math.max(size.x, size.y, size.z) * 1e-4, 1e-5);
    const supportCorners = corners.filter((corner) => corner.dot(direction) >= extreme - tolerance);
    return supportCorners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3())
        .multiplyScalar(1 / supportCorners.length);
}

function clipPolygonAgainstPlane(polygon, normal, offset) {
    if (!polygon.length) return polygon;

    const clipped = [];
    let previous = polygon[polygon.length - 1];
    let previousDistance = normal.dot(previous) - offset;

    for (const current of polygon) {
        const currentDistance = normal.dot(current) - offset;
        const previousInside = previousDistance <= 1e-6;
        const currentInside = currentDistance <= 1e-6;

        if (previousInside !== currentInside) {
            const fraction = previousDistance / (previousDistance - currentDistance);
            clipped.push(previous.clone().lerp(current, fraction));
        }
        if (currentInside) clipped.push(current.clone());

        previous = current;
        previousDistance = currentDistance;
    }

    return clipped;
}

function getFaceContactManifold(reference, incident, referenceAxisIndex, referenceNormal, penetration) {
    const referenceAxis = reference.axes[referenceAxisIndex];
    const referenceSign = Math.sign(referenceAxis.dot(referenceNormal)) || 1;
    const referenceFaceCenter = reference.center.clone()
        .addScaledVector(referenceAxis, reference.half.getComponent(referenceAxisIndex) * referenceSign);
    const sideAxisIndices = [0, 1, 2].filter((index) => index !== referenceAxisIndex);

    let incidentAxisIndex = 0;
    let incidentAlignment = -Infinity;
    for (let index = 0; index < 3; index++) {
        const alignment = Math.abs(incident.axes[index].dot(referenceNormal));
        if (alignment > incidentAlignment) {
            incidentAlignment = alignment;
            incidentAxisIndex = index;
        }
    }

    const incidentAxis = incident.axes[incidentAxisIndex];
    const incidentSign = incidentAxis.dot(referenceNormal) > 0 ? -1 : 1;
    const incidentFaceCenter = incident.center.clone()
        .addScaledVector(incidentAxis, incident.half.getComponent(incidentAxisIndex) * incidentSign);
    const incidentSideAxisIndices = [0, 1, 2].filter((index) => index !== incidentAxisIndex);
    const firstAxis = incident.axes[incidentSideAxisIndices[0]];
    const secondAxis = incident.axes[incidentSideAxisIndices[1]];
    const firstExtent = incident.half.getComponent(incidentSideAxisIndices[0]);
    const secondExtent = incident.half.getComponent(incidentSideAxisIndices[1]);
    let polygon = [
        incidentFaceCenter.clone().addScaledVector(firstAxis, -firstExtent).addScaledVector(secondAxis, -secondExtent),
        incidentFaceCenter.clone().addScaledVector(firstAxis, firstExtent).addScaledVector(secondAxis, -secondExtent),
        incidentFaceCenter.clone().addScaledVector(firstAxis, firstExtent).addScaledVector(secondAxis, secondExtent),
        incidentFaceCenter.clone().addScaledVector(firstAxis, -firstExtent).addScaledVector(secondAxis, secondExtent)
    ];

    for (const sideIndex of sideAxisIndices) {
        const sideAxis = reference.axes[sideIndex];
        const sideExtent = reference.half.getComponent(sideIndex);
        polygon = clipPolygonAgainstPlane(
            polygon,
            sideAxis,
            sideAxis.dot(referenceFaceCenter) + sideExtent
        );
        polygon = clipPolygonAgainstPlane(
            polygon,
            sideAxis.clone().negate(),
            -sideAxis.dot(referenceFaceCenter) + sideExtent
        );
    }

    const contacts = [];
    const minimumDepth = -Math.max(penetration + 0.002, 0.002);
    for (const point of polygon) {
        const depth = referenceNormal.dot(referenceFaceCenter.clone().sub(point));
        if (depth < minimumDepth) continue;

        const contactPoint = point.clone().addScaledVector(referenceNormal, depth * 0.5);
        if (!contacts.some((contact) => contact.point.distanceToSquared(contactPoint) < 1e-8)) {
            contacts.push({ point: contactPoint, penetration: Math.max(depth, 0) });
        }
    }

    if (contacts.length) return contacts;
    return [{
        point: getOBBSupportPoint(reference.object, reference.size, referenceNormal)
            .add(getOBBSupportPoint(incident.object, incident.size, referenceNormal.clone().negate()))
            .multiplyScalar(0.5),
        penetration
    }];
}

function generateContactManifold(objectA, objectB, obbA, obbB, minimumAxis, normal, penetration) {
    if (minimumAxis.type === "faceA") {
        return getFaceContactManifold(obbA, obbB, minimumAxis.index, normal, penetration);
    }
    if (minimumAxis.type === "faceB") {
        return getFaceContactManifold(obbB, obbA, minimumAxis.index, normal.clone().negate(), penetration);
    }

    const pointA = getOBBSupportPoint(objectA, obbA.size, normal);
    const pointB = getOBBSupportPoint(objectB, obbB.size, normal.clone().negate());
    return [{ point: pointA.add(pointB).multiplyScalar(0.5), penetration }];
}

function applyImpulseAtPoint(object, physics, impulse, point) {
    physics.velocity.addScaledVector(impulse, 1 / physics.mass);
    const center = object.getWorldPosition(new THREE.Vector3());
    const torque = new THREE.Vector3().crossVectors(point.clone().sub(center), impulse);
    physics.angularVelocity.add(getInverseInertiaWorld(object, physics.size, torque));
}

function resolveGroundCollision(object, physics, delta) {
    const overGround = Math.abs(object.position.x) <= groundHalfSize
        && Math.abs(object.position.z) <= groundHalfSize;
    if (!overGround) {
        object.userData.groundContact = false;
        object.userData.groundContactTime = 0;
        return;
    }

    const corners = getOBBCorners(object, physics.size);
    const lowestY = Math.min(...corners.map((corner) => corner.y));
    if (lowestY > groundY + 1e-5) {
        object.userData.groundContact = false;
        object.userData.groundContactTime = 0;
        return;
    }

    object.position.y += groundY - lowestY;
    const correctedCorners = getOBBCorners(object, physics.size);
    const correctedLowestY = Math.min(...correctedCorners.map((corner) => corner.y));
    const contactTolerance = Math.max(Math.max(physics.size.x, physics.size.y, physics.size.z) * 1e-4, 1e-5);
    const contacts = correctedCorners.filter((corner) => corner.y <= correctedLowestY + contactTolerance);
    const contactPoint = contacts.reduce((sum, corner) => sum.add(corner), new THREE.Vector3())
        .multiplyScalar(1 / contacts.length);
    const center = object.getWorldPosition(new THREE.Vector3());
    const arm = contactPoint.clone().sub(center);
    const normal = new THREE.Vector3(0, 1, 0);
    const contactVelocity = physics.velocity.clone()
        .add(new THREE.Vector3().crossVectors(physics.angularVelocity, arm));
    const normalSpeed = contactVelocity.dot(normal);

    if (normalSpeed < 0 && !object.userData.dragging) {
        if (object.userData.launched) {
            object.userData.groundImpact = true;
            object.userData.groundContactTime = 0;
        }
        const angularArm = new THREE.Vector3().crossVectors(arm, normal);
        const effectiveMass = 1 / physics.mass + angularArm.dot(
            getInverseInertiaWorld(object, physics.size, angularArm)
        );
        const restitution = normalSpeed < -0.5 ? 0.08 : 0;
        const normalImpulse = -(1 + restitution) * normalSpeed / Math.max(effectiveMass, 1e-5);
        applyImpulseAtPoint(object, physics, normal.clone().multiplyScalar(normalImpulse), contactPoint);

        const tangentVelocity = contactVelocity.addScaledVector(normal, -normalSpeed);
        const tangentSpeed = tangentVelocity.length();
        if (tangentSpeed > 1e-5) {
            const tangent = tangentVelocity.multiplyScalar(1 / tangentSpeed);
            const tangentArm = new THREE.Vector3().crossVectors(arm, tangent);
            const tangentEffectiveMass = 1 / physics.mass + tangentArm.dot(
                getInverseInertiaWorld(object, physics.size, tangentArm)
            );
            const frictionImpulse = Math.min(
                tangentSpeed / Math.max(tangentEffectiveMass, 1e-5),
                normalImpulse * 0.65
            );
            applyImpulseAtPoint(object, physics, tangent.multiplyScalar(-frictionImpulse), contactPoint);
        }
    }

    if (!object.userData.dragging) {
        const centerOfMass = object.userData.centerOfMass
            ? object.userData.centerOfMass.clone().applyQuaternion(object.quaternion).add(center)
            : center;
        const gravityForce = new THREE.Vector3(0, -gravityAcceleration * physics.mass, 0);
        const gravityTorque = new THREE.Vector3()
            .crossVectors(centerOfMass.sub(contactPoint), gravityForce);
        physics.angularVelocity.addScaledVector(
            getInverseInertiaWorld(object, physics.size, gravityTorque),
            delta
        );
    }
    physics.velocity.y = Math.max(physics.velocity.y, 0);
    object.userData.groundContact = true;
    object.userData.contact = true;
    object.userData.groundContactTime = (object.userData.groundContactTime || 0) + delta;
}

function resolveTrampolineCollision(object, physics, previousPosition) {
    if (!trampolineObject || !trampolineMembrane || object.userData.dragging) return false;

    trampolineObject.updateWorldMatrix(true, false);
    const trampolineTopPoint = trampolineObject.localToWorld(trampolineMembrane.center.clone());
    const worldScale = trampolineObject.getWorldScale(new THREE.Vector3());
    const membraneRadius = trampolineMembrane.radius * Math.max(worldScale.x, worldScale.z);
    const trampolineTop = trampolineTopPoint.y;
    const separationGap = 0.04;
    const objectVerticalHalf = getVerticalHalfExtent(object, physics.size);
    const wasFullyBelowMembrane = previousPosition.y + objectVerticalHalf < trampolineTop - separationGap;
    const isFullyBelowMembrane = object.position.y + objectVerticalHalf < trampolineTop - separationGap;
    if (wasFullyBelowMembrane && isFullyBelowMembrane) {
        object.userData.trampolineContact = false;
        return false;
    }

    const corners = getOBBCorners(object, physics.size);
    const membraneCorners = corners.filter((corner) =>
        Math.hypot(corner.x - trampolineTopPoint.x, corner.z - trampolineTopPoint.z) <= membraneRadius
    );
    const lowestMembraneY = membraneCorners.length
        ? Math.min(...membraneCorners.map((corner) => corner.y))
        : Infinity;
    const onMembrane = lowestMembraneY <= trampolineTop + separationGap;
    if (!onMembrane) {
        object.userData.trampolineContact = false;
    }

    if (onMembrane && object.userData.trampolineContact) {
        if (lowestMembraneY < trampolineTop) {
            object.position.y += trampolineTop - lowestMembraneY;
        }
        physics.velocity.y = Math.max(physics.velocity.y, 0);
        object.userData.contact = true;
        return false;
    }

    const contacts = corners.filter((corner) =>
        Math.hypot(corner.x - trampolineTopPoint.x, corner.z - trampolineTopPoint.z) <= membraneRadius
        && corner.y <= trampolineTop + 1e-4
    );
    if (!contacts.length) return false;

    const lowestY = Math.min(...contacts.map((corner) => corner.y));
    if (lowestY > trampolineTop) return false;
    const lowestContacts = contacts.filter((corner) => corner.y <= lowestY + 1e-4);
    const impactPoint = lowestContacts.reduce((sum, corner) => sum.add(corner), new THREE.Vector3())
        .multiplyScalar(1 / lowestContacts.length);
    const impactArm = impactPoint.clone().sub(object.getWorldPosition(new THREE.Vector3()));
    const impactVelocity = physics.velocity.clone()
        .add(new THREE.Vector3().crossVectors(physics.angularVelocity, impactArm));
    const normal = new THREE.Vector3(0, 1, 0);
    const normalSpeed = impactVelocity.dot(normal);
    if (normalSpeed >= 0) return false;
    playTrampolineBounceSound(-normalSpeed);

    object.position.y += trampolineTop - lowestY;
    const correctedCorners = getOBBCorners(object, physics.size);
    const contactCorners = correctedCorners.filter((corner) =>
        Math.hypot(corner.x - trampolineTopPoint.x, corner.z - trampolineTopPoint.z) <= membraneRadius
        && corner.y <= trampolineTop + 1e-4
    );
    if (!contactCorners.length) return false;

    const contactPoint = contactCorners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3())
        .multiplyScalar(1 / contactCorners.length);
    contactPoint.y = trampolineTop;
    const center = object.getWorldPosition(new THREE.Vector3());
    const arm = contactPoint.clone().sub(center);
    const contactVelocity = physics.velocity.clone()
        .add(new THREE.Vector3().crossVectors(physics.angularVelocity, arm));

    const angularArm = new THREE.Vector3().crossVectors(arm, normal);
    const effectiveMass = 1 / physics.mass + angularArm.dot(
        getInverseInertiaWorld(object, physics.size, angularArm)
    );
    const restitution = Math.sqrt(trampolineBounceHeightRatio);
    const normalImpulse = -(1 + restitution) * normalSpeed / Math.max(effectiveMass, 1e-5);
    applyImpulseAtPoint(object, physics, normal.clone().multiplyScalar(normalImpulse), contactPoint);

    const tangentVelocity = contactVelocity.addScaledVector(normal, -normalSpeed);
    const tangentSpeed = tangentVelocity.length();
    if (tangentSpeed > 1e-5) {
        const tangent = tangentVelocity.multiplyScalar(1 / tangentSpeed);
        const tangentArm = new THREE.Vector3().crossVectors(arm, tangent);
        const tangentEffectiveMass = 1 / physics.mass + tangentArm.dot(
            getInverseInertiaWorld(object, physics.size, tangentArm)
        );
        const frictionImpulse = Math.min(
            tangentSpeed / Math.max(tangentEffectiveMass, 1e-5),
            normalImpulse * 0.3
        );
        applyImpulseAtPoint(object, physics, tangent.multiplyScalar(-frictionImpulse), contactPoint);
    }

    object.userData.contact = true;
    object.userData.trampolineImpact = true;
    object.userData.trampolineContact = true;
    return true;
}

function resolveTrampolineLegCollisions(object, physics) {
    if (!trampolineObject || !trampolineLegColliders.length || object.userData.dragging) return;

    const objectCenter = object.getWorldPosition(new THREE.Vector3());
    const objectHalf = physics.size.clone().multiplyScalar(0.5);
    const objectQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
    const objectAxes = [
        new THREE.Vector3(1, 0, 0).applyQuaternion(objectQuaternion),
        new THREE.Vector3(0, 1, 0).applyQuaternion(objectQuaternion),
        new THREE.Vector3(0, 0, 1).applyQuaternion(objectQuaternion)
    ];
    const objectVerticalHalf = getVerticalHalfExtent(object, physics.size);

    for (const leg of trampolineLegColliders) {
        const legCenter = trampolineObject.position.clone().add(leg.localCenter);
        const legHalf = leg.size.clone().multiplyScalar(0.5);
        const verticalOverlap = objectCenter.y + objectVerticalHalf - (legCenter.y - legHalf.y);
        if (verticalOverlap <= 0 || objectCenter.y - objectVerticalHalf >= legCenter.y + legHalf.y) continue;

        const horizontalAxes = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 0, 1)
        ];
        for (const objectAxis of objectAxes) {
            const horizontalAxis = new THREE.Vector3(objectAxis.x, 0, objectAxis.z);
            if (horizontalAxis.lengthSq() > 1e-8) horizontalAxes.push(horizontalAxis.normalize());
        }

        const offset = objectCenter.clone().sub(legCenter);
        let minimumOverlap = Infinity;
        const normal = new THREE.Vector3();
        let intersects = true;
        for (const axis of horizontalAxes) {
            const objectProjection = objectHalf.x * Math.abs(axis.dot(objectAxes[0]))
                + objectHalf.y * Math.abs(axis.dot(objectAxes[1]))
                + objectHalf.z * Math.abs(axis.dot(objectAxes[2]));
            const legProjection = legHalf.x * Math.abs(axis.x) + legHalf.z * Math.abs(axis.z);
            const overlap = objectProjection + legProjection - Math.abs(offset.dot(axis));
            if (overlap <= 0) {
                intersects = false;
                break;
            }
            if (overlap < minimumOverlap) {
                minimumOverlap = overlap;
                normal.copy(axis);
                if (normal.dot(offset) < 0) normal.negate();
            }
        }
        if (!intersects) continue;

        object.position.addScaledVector(normal, minimumOverlap + 0.001);
        const contactPoint = getOBBSupportPoint(object, physics.size, normal.clone().negate());
        contactPoint.y = THREE.MathUtils.clamp(
            contactPoint.y,
            Math.max(objectCenter.y - objectVerticalHalf, legCenter.y - legHalf.y),
            Math.min(objectCenter.y + objectVerticalHalf, legCenter.y + legHalf.y)
        );
        const arm = contactPoint.clone().sub(object.getWorldPosition(new THREE.Vector3()));
        const contactVelocity = physics.velocity.clone()
            .add(new THREE.Vector3().crossVectors(physics.angularVelocity, arm));
        const normalSpeed = contactVelocity.dot(normal);

        if (normalSpeed < 0) {
            const angularArm = new THREE.Vector3().crossVectors(arm, normal);
            const effectiveMass = 1 / physics.mass + angularArm.dot(
                getInverseInertiaWorld(object, physics.size, angularArm)
            );
            const normalImpulse = -normalSpeed / Math.max(effectiveMass, 1e-5);
            applyImpulseAtPoint(object, physics, normal.clone().multiplyScalar(normalImpulse), contactPoint);

            const tangentVelocity = contactVelocity.addScaledVector(normal, -normalSpeed);
            const tangentSpeed = tangentVelocity.length();
            if (tangentSpeed > 1e-5) {
                const tangent = tangentVelocity.multiplyScalar(1 / tangentSpeed);
                const tangentArm = new THREE.Vector3().crossVectors(arm, tangent);
                const tangentEffectiveMass = 1 / physics.mass + tangentArm.dot(
                    getInverseInertiaWorld(object, physics.size, tangentArm)
                );
                const frictionImpulse = Math.min(
                    tangentSpeed / Math.max(tangentEffectiveMass, 1e-5),
                    normalImpulse * 0.55
                );
                applyImpulseAtPoint(object, physics, tangent.multiplyScalar(-frictionImpulse), contactPoint);
            }
        }
        object.userData.contact = true;
    }
}

function updateHitbox(object, size) {
    let hitbox = hitboxLines.get(object);
    if (!hitbox) {
        const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
        hitbox = new THREE.LineSegments(geometry, hitboxMaterial);
        hitbox.renderOrder = 10;
        hitboxLines.set(object, hitbox);
        scene.add(hitbox);
    }

    hitbox.position.copy(object.position);
    hitbox.quaternion.copy(object.quaternion);
    hitbox.updateMatrixWorld(true);
}

function removeHitbox(object) {
    const hitbox = hitboxLines.get(object);
    if (!hitbox) return;
    scene.remove(hitbox);
    hitbox.geometry.dispose();
    hitboxLines.delete(object);
}

function registerPhysicsObject(object, size, velocity, angularVelocity, name) {
    object.userData.physics = {
        id: name || `Object ${nextObjectId++}`,
        size,
        mass: Math.max(size.x * size.y * size.z, 0.01),
        velocity,
        angularVelocity
    };
    object.userData.centerOfMass = getCenterOfMass(object);
    object.userData.stableTime = 0;
    physicsObjects.push(object);
    updateHitbox(object, size);
}

function removePhysicsObject(object) {
    if (!object) return;
    console.log(`오브젝트 삭제: ${object.userData.physics?.id || "unknown"}`);

    if (activeDragObject === object) {
        object.userData.dragging = false;
        activeDragObject = null;
        controls.enabled = true;
    }

    if (object === draggedObject) draggedObject = null;
    if (object === interactionObject) interactionObject = null;

    const index = physicsObjects.indexOf(object);
    if (index >= 0) physicsObjects.splice(index, 1);
    scene.remove(object);
    removeHitbox(object);

    if (selectedObject === object) selectObject(null);
}

const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.8,
    metalness: 0.1
});

const statusElement = document.getElementById("status");

function setPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

renderer.domElement.addEventListener("pointermove", (event) => {
    setPointer(event);
});

function prepareModel(model, xPosition) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(center);

    const wrapper = new THREE.Group();
    wrapper.add(model);
    wrapper.position.set(xPosition, 0, 0);
    scene.add(wrapper);

    wrapper.traverse((object) => {
        if (object.isMesh) {
            object.castShadow = true;
            object.receiveShadow = true;
        }
    });

    return { wrapper, size };
}

function loadModel(path, xPosition, onLoaded) {
    new GLTFLoader().load(path, (gltf) => {
        const result = prepareModel(gltf.scene, xPosition);
        onLoaded(result.wrapper, result.size);
    }, undefined, (error) => console.error(`${path} 로딩 실패:`, error));
}

loadModel("./object.glb", -10, (wrapper, size) => {
    draggedObject = wrapper;
    draggedSize.copy(size);
    objectTemplate = wrapper;
    registerPhysicsObject(wrapper, size, draggedVelocity, draggedAngularVelocity, "Object 1");
    groundY = -size.y / 2;
    if (trampolineObject && trampolineSize) {
        trampolineObject.position.y = groundY + trampolineSize.y / 2;
    }

    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(groundSize, groundSize),
        groundMaterial
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = groundY;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(groundSize, 100, 0x64748b, 0x1e293b);
    grid.position.y = groundY + 0.002;
    scene.add(grid);

    const maxSize = Math.max(size.x, size.y, size.z);
    setInitialCameraView(maxSize);
});

loadModel("./object2.glb", 10, (wrapper, size) => {
    interactionObject = wrapper;
    interactionSize.copy(size);
    object2Template = wrapper;
    registerPhysicsObject(wrapper, size, interactionVelocity, interactionAngularVelocity, "Object 2");
    setInitialCameraView(Math.max(
        draggedSize.x, draggedSize.y, draggedSize.z,
        size.x, size.y, size.z
    ));
    wrapper.traverse((object) => {
        if (!object.isMesh) return;
        if (Array.isArray(object.material)) {
            object.material = object.material.map((material) => {
                const clone = material.clone();
                clone.emissive = clone.emissive ? clone.emissive.clone() : new THREE.Color(0x000000);
                clone.emissiveIntensity = 0;
                object2Materials.push(clone);
                return clone;
            });
        } else if (object.material) {
            const clone = object.material.clone();
            clone.emissive = clone.emissive ? clone.emissive.clone() : new THREE.Color(0x000000);
            clone.emissiveIntensity = 0;
            object2Materials.push(clone);
            object.material = clone;
        }
    });
});

loadModel("./trampoline.glb", 0, (wrapper, size) => {
    trampolineObject = wrapper;
    trampolineSize = size.clone();
    trampolineObject.scale.setScalar(5);
    trampolineSize.multiplyScalar(5);
    trampolineObject.position.set(0, groundY + trampolineSize.y / 2, 0);
    trampolineObject.userData.fixed = true;
    trampolineObject.updateWorldMatrix(true, true);
    trampolineObject.traverse((object) => {
        if (object.isMesh) {
            object.castShadow = true;
            object.receiveShadow = true;

            const bounds = new THREE.Box3().setFromObject(object);
            const legSize = bounds.getSize(new THREE.Vector3());
            if (legSize.y > legSize.x * 3 && legSize.y > legSize.z * 2) {
                trampolineLegColliders.push({
                    localCenter: bounds.getCenter(new THREE.Vector3()).sub(trampolineObject.position),
                    size: legSize
                });
            }

            const position = object.geometry.attributes.position;
            const index = object.geometry.index;
            const materialGroups = Array.isArray(object.material)
                ? object.geometry.groups.map((group) => ({
                    group,
                    material: object.material[group.materialIndex]
                }))
                : [{
                    group: { start: 0, count: index ? index.count : position.count },
                    material: object.material
                }];
            for (const { group, material } of materialGroups) {
                if (!material?.color || Math.max(material.color.r, material.color.g, material.color.b) > 0.08) continue;

                const membraneBounds = new THREE.Box3();
                const localPoint = new THREE.Vector3();
                const end = group.start + group.count;
                for (let i = group.start; i < end; i++) {
                    const vertexIndex = index ? index.getX(i) : i;
                    localPoint.fromBufferAttribute(position, vertexIndex);
                    object.localToWorld(localPoint);
                    trampolineObject.worldToLocal(localPoint);
                    membraneBounds.expandByPoint(localPoint);
                }

                if (membraneBounds.isEmpty()) continue;
                const center = membraneBounds.getCenter(new THREE.Vector3());
                center.y = membraneBounds.max.y;
                trampolineMembrane = {
                    center,
                    radius: Math.max(
                        Math.abs(membraneBounds.min.x - center.x),
                        Math.abs(membraneBounds.max.x - center.x),
                        Math.abs(membraneBounds.min.z - center.z),
                        Math.abs(membraneBounds.max.z - center.z)
                    )
                };
            }
        }
    });
    if (!trampolineMembrane) {
        throw new Error("트램폴린 검정색 면의 충돌 정보를 찾지 못했습니다.");
    }
    if (objectTemplate) {
        setInitialCameraView(Math.max(
            draggedSize.x, draggedSize.y, draggedSize.z,
            interactionSize.x, interactionSize.y, interactionSize.z
        ));
    }
});

loadModel("./boom.glb", 0, (wrapper, size) => {
    boomTemplate = wrapper;
    boomTemplateSize = size.clone();
    scene.remove(wrapper);
    wrapper.visible = false;
});

function getIntersection() {
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.at(activeDragDistance, new THREE.Vector3());
}

renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!physicsObjects.length) return;
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);

    const candidates = physicsObjects
        .map((object) => ({ object, hits: raycaster.intersectObject(object, true) }))
        .filter((entry) => entry.hits.length)
        .sort((a, b) => a.hits[0].distance - b.hits[0].distance);

    if (!candidates.length) {
        selectObject(null);
        return;
    }
    activeDragObject = candidates[0].object;
    selectObject(activeDragObject);
    activeDragObject.userData.trampolineContact = false;
    const hitPoint = candidates[0].hits[0].point;

    camera.updateWorldMatrix(true, false);
    const cameraQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
    activeDragOffset.copy(hitPoint)
        .sub(activeDragObject.position)
        .applyQuaternion(cameraQuaternion.invert());
    activeDragDistance = raycaster.ray.origin.distanceTo(hitPoint);
    activeDragVelocity.set(0, 0, 0);
    activeDragLastUpdateTime = performance.now();
    const physics = activeDragObject.userData.physics;
    if (physics) {
        physics.velocity.set(0, 0, 0);
        physics.angularVelocity.set(0, 0, 0);
    }

    activeDragObject.userData.dragging = true;
    controls.enabled = false;
    renderer.domElement.style.cursor = "grabbing";
    renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", (event) => {
    if (!activeDragObject?.userData.dragging) {
        setPointer(event);
        raycaster.setFromCamera(pointer, camera);
        const overObject = physicsObjects.some((object) =>
            raycaster.intersectObject(object, true).length
        );
        renderer.domElement.style.cursor = overObject ? "grab" : "default";
        return;
    }

    setPointer(event);
    updateDraggedObject();
});

function updateDraggedObject() {
    if (!activeDragObject?.userData.dragging) return;

    const point = getIntersection();
    if (!point) return;

    const cameraQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
    const worldOffset = activeDragOffset.clone().applyQuaternion(cameraQuaternion);
    const previousPosition = activeDragObject.position.clone();
    activeDragObject.position.copy(point).sub(worldOffset);
    const dragPhysics = activeDragObject.userData.physics;
    if (dragPhysics) {
        const dragFloorTop = groundY + getVerticalHalfExtent(activeDragObject, dragPhysics.size);
        activeDragObject.position.y = Math.max(activeDragObject.position.y, dragFloorTop + 0.01);
        dragPhysics.velocity.set(0, 0, 0);
        dragPhysics.angularVelocity.set(0, 0, 0);
    }

    const now = performance.now();
    const elapsed = Math.max((now - activeDragLastUpdateTime) / 1000, 1 / 240);
    const movement = activeDragObject.position.clone().sub(previousPosition);
    if (movement.lengthSq() > 1e-6) {
        const measuredVelocity = movement.multiplyScalar(1 / elapsed);
        if (measuredVelocity.length() > 25) measuredVelocity.setLength(25);
        activeDragVelocity.lerp(measuredVelocity, THREE.MathUtils.clamp(elapsed * 18, 0, 1));
    } else {
        activeDragVelocity.multiplyScalar(Math.exp(-18 * elapsed));
        if (activeDragVelocity.lengthSq() < 0.0025) activeDragVelocity.set(0, 0, 0);
    }
    activeDragLastUpdateTime = now;

    checkInteraction();
}

function endDrag(event) {
    if (!activeDragObject?.userData.dragging) return;
    const physics = activeDragObject.userData.physics;
    if (physics) {
        physics.velocity.copy(activeDragVelocity);
        physics.angularVelocity.set(0, 0, 0);
    }
    activeDragObject.userData.dragging = false;
    activeDragObject = null;
    activeDragVelocity.set(0, 0, 0);
    controls.enabled = true;
    renderer.domElement.style.cursor = "grab";
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }
}

renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

function resolveObjectCollision(objectA, objectB) {
    const physicsA = objectA.userData.physics;
    const physicsB = objectB.userData.physics;
    if (!physicsA || !physicsB) return false;

    function getOBB(object, size) {
        object.updateWorldMatrix(true, false);
        const center = new THREE.Vector3();
        object.getWorldPosition(center);
        const quaternion = new THREE.Quaternion();
        object.getWorldQuaternion(quaternion);
        const rotation = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
        const axes = [
            new THREE.Vector3(1, 0, 0).applyMatrix4(rotation).normalize(),
            new THREE.Vector3(0, 1, 0).applyMatrix4(rotation).normalize(),
            new THREE.Vector3(0, 0, 1).applyMatrix4(rotation).normalize()
        ];
        const half = size.clone().multiplyScalar(0.5);
        return { object, size, center, axes, half };
    }

    const obbA = getOBB(objectA, physicsA.size);
    const obbB = getOBB(objectB, physicsB.size);
    const centerA = obbA.center;
    const centerB = obbB.center;
    const axes = [
        ...obbA.axes.map((axis, index) => ({ axis, type: "faceA", index })),
        ...obbB.axes.map((axis, index) => ({ axis, type: "faceB", index }))
    ];

    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            const axis = new THREE.Vector3().crossVectors(obbA.axes[i], obbB.axes[j]);
            if (axis.lengthSq() > 1e-8) axes.push({ axis: axis.normalize(), type: "edge" });
        }
    }

    let overlap = Infinity;
    const normal = new THREE.Vector3();
    let minimumAxis = null;
    const delta = centerB.clone().sub(centerA);

    for (const candidate of axes) {
        const axis = candidate.axis;
        const projectionA = obbA.half.x * Math.abs(axis.dot(obbA.axes[0]))
            + obbA.half.y * Math.abs(axis.dot(obbA.axes[1]))
            + obbA.half.z * Math.abs(axis.dot(obbA.axes[2]));
        const projectionB = obbB.half.x * Math.abs(axis.dot(obbB.axes[0]))
            + obbB.half.y * Math.abs(axis.dot(obbB.axes[1]))
            + obbB.half.z * Math.abs(axis.dot(obbB.axes[2]));
        const distance = Math.abs(delta.dot(axis));
        const axisOverlap = projectionA + projectionB - distance;

        if (axisOverlap <= 0) return false;
        if (axisOverlap < overlap) {
            overlap = axisOverlap;
            minimumAxis = candidate;
            normal.copy(axis);
            if (normal.dot(delta) < 0) normal.negate();
        }
    }

    const draggingA = objectA.userData.dragging;
    const draggingB = objectB.userData.dragging;
    const positionalSlop = 0.002;
    const inverseMassA = draggingA ? 0 : 1 / physicsA.mass;
    const inverseMassB = draggingB ? 0 : 1 / physicsB.mass;
    const inverseMassSum = inverseMassA + inverseMassB;
    if (inverseMassSum > 0) {
        const correction = Math.max(overlap - positionalSlop, 0) * 0.65;
        objectA.position.addScaledVector(normal, -correction * inverseMassA / inverseMassSum);
        objectB.position.addScaledVector(normal, correction * inverseMassB / inverseMassSum);
    }
    obbA.center.copy(objectA.getWorldPosition(new THREE.Vector3()));
    obbB.center.copy(objectB.getWorldPosition(new THREE.Vector3()));

    const verticalContact = Math.abs(normal.y) > 0.7;
    if (verticalContact) {
        const upperObject = normal.y > 0 ? objectB : objectA;
        upperObject.userData.verticalSupport = true;
    }
    objectA.userData.contact = true;
    objectB.userData.contact = true;

    const manifold = generateContactManifold(objectA, objectB, obbA, obbB, minimumAxis, normal, overlap);
    for (const contact of manifold) {
        const point = contact.point;
        const armA = point.clone().sub(objectA.getWorldPosition(new THREE.Vector3()));
        const armB = point.clone().sub(objectB.getWorldPosition(new THREE.Vector3()));
        const velocityAtA = physicsA.velocity.clone()
            .add(new THREE.Vector3().crossVectors(physicsA.angularVelocity, armA));
        const velocityAtB = physicsB.velocity.clone()
            .add(new THREE.Vector3().crossVectors(physicsB.angularVelocity, armB));
        const relativeVelocity = velocityAtB.sub(velocityAtA);
        const normalSpeed = relativeVelocity.dot(normal);
        let normalImpulseMagnitude = 0;

        if (normalSpeed < 0 && inverseMassSum > 0) {
            const angularArmA = new THREE.Vector3().crossVectors(armA, normal);
            const angularArmB = new THREE.Vector3().crossVectors(armB, normal);
            const effectiveMass = inverseMassA + inverseMassB
                + (draggingA ? 0 : angularArmA.dot(getInverseInertiaWorld(objectA, physicsA.size, angularArmA)))
                + (draggingB ? 0 : angularArmB.dot(getInverseInertiaWorld(objectB, physicsB.size, angularArmB)));
            const restitution = normalSpeed < -0.5 ? (verticalContact ? 0.05 : 0.2) : 0;
            normalImpulseMagnitude = -(1 + restitution) * normalSpeed / Math.max(effectiveMass, 1e-5);
            const impulse = normal.clone().multiplyScalar(normalImpulseMagnitude);
            if (!draggingA) applyImpulseAtPoint(objectA, physicsA, impulse.clone().negate(), point);
            if (!draggingB) applyImpulseAtPoint(objectB, physicsB, impulse, point);
        }

        if (normalImpulseMagnitude > 0) {
            const postImpulseVelocityA = physicsA.velocity.clone()
                .add(new THREE.Vector3().crossVectors(physicsA.angularVelocity, armA));
            const postImpulseVelocityB = physicsB.velocity.clone()
                .add(new THREE.Vector3().crossVectors(physicsB.angularVelocity, armB));
            const relativePostImpulseVelocity = postImpulseVelocityB.sub(postImpulseVelocityA);
            const tangentVelocity = relativePostImpulseVelocity.clone()
                .addScaledVector(normal, -relativePostImpulseVelocity.dot(normal));
            const tangentSpeed = tangentVelocity.length();
            if (tangentSpeed > 1e-5) {
                const tangent = tangentVelocity.multiplyScalar(1 / tangentSpeed);
                const angularTangentA = new THREE.Vector3().crossVectors(armA, tangent);
                const angularTangentB = new THREE.Vector3().crossVectors(armB, tangent);
                const tangentEffectiveMass = inverseMassA + inverseMassB
                    + (draggingA ? 0 : angularTangentA.dot(getInverseInertiaWorld(objectA, physicsA.size, angularTangentA)))
                    + (draggingB ? 0 : angularTangentB.dot(getInverseInertiaWorld(objectB, physicsB.size, angularTangentB)));
                const frictionImpulseMagnitude = Math.min(
                    tangentSpeed / Math.max(tangentEffectiveMass, 1e-5),
                    normalImpulseMagnitude * 0.65
                );
                const frictionImpulse = tangent.multiplyScalar(frictionImpulseMagnitude);
                if (!draggingA) applyImpulseAtPoint(objectA, physicsA, frictionImpulse, point);
                if (!draggingB) applyImpulseAtPoint(objectB, physicsB, frictionImpulse.negate(), point);
            }
        }
    }

    return true;
}

function checkInteraction(delta = 1 / 60) {
    let active = false;
    for (const object of physicsObjects) {
        object.userData.contact = false;
        object.userData.verticalSupport = false;
    }
    for (let pass = 0; pass < 8; pass++) {
        active = false;
        for (let i = 0; i < physicsObjects.length; i++) {
            for (let j = i + 1; j < physicsObjects.length; j++) {
                if (resolveObjectCollision(physicsObjects[i], physicsObjects[j])) active = true;
            }
        }
    }

    for (const object of physicsObjects) {
        const physics = object.userData.physics;
        if (!physics) continue;
        resolveGroundCollision(object, physics, delta);
    }

    if (active && !interactionActive) {
        interactionActive = true;
        if (statusElement) {
            statusElement.textContent = "오브젝트 충돌 감지! 💥";
            statusElement.classList.add("active");
        }
    } else if (!active && interactionActive) {
        interactionActive = false;
        if (statusElement) {
            statusElement.textContent = "";
            statusElement.classList.remove("active");
        }
    }
}

function setObject2Glow(active, time = 0) {
    const intensity = active ? 0.8 + Math.sin(time * 0.006) * 0.35 : 0;
    object2Materials.forEach((material) => {
        material.emissive.setHex(active ? 0x00aaff : 0x000000);
        material.emissiveIntensity = intensity;
    });
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("keydown", (event) => {
    const key = event.key === " " ? "space" : event.key.toLowerCase();
    if (["w", "a", "s", "d", "r", "space", "shift"].includes(key)) {
        pressedKeys.add(key);
        event.preventDefault();
    }

    if (key === "e" && !event.repeat) {
        const running = !simulationRunning;
        setSimulationRunning(running);
        if (running) {
            simulationPrompt.classList.add("hidden");
        }
        event.preventDefault();
    }

    if (key === "f" && !event.repeat) {
        addObjectAndLaunch();
        event.preventDefault();
    }

    if (key === "t" && !event.repeat) {
        resetGame();
        event.preventDefault();
    }

    if (key === "g" && !event.repeat) {
        launchBoom();
        event.preventDefault();
    }

    if (key === "backspace" && !event.repeat) {
        removeSelectedObject();
        event.preventDefault();
    }
});

window.addEventListener("keyup", (event) => {
    const key = event.key === " " ? "space" : event.key.toLowerCase();
    pressedKeys.delete(key);
});

window.addEventListener("blur", () => pressedKeys.clear());

const addObjectButton = document.getElementById("add-object");
const removeObjectButton = document.getElementById("remove-object");
const velocityList = document.getElementById("velocity-list");
const simulationPrompt = document.getElementById("simulation-prompt");
const toggleSimulationButton = document.getElementById("toggle-simulation");
const shortcutGuide = document.getElementById("shortcut-guide");
const volumeSlider = document.getElementById("volume-slider");
const volumeValue = document.getElementById("volume-value");

volumeSlider.addEventListener("input", () => {
    masterVolume = Number(volumeSlider.value) / 100;
    volumeValue.textContent = `${volumeSlider.value}%`;
    if (masterAudioGain) {
        masterAudioGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.015);
    }
});

function setSimulationRunning(running) {
    simulationRunning = running;
    lastPhysicsTime = performance.now();
    if (running) resumeAudio();
    shortcutGuide.classList.toggle("running", running);
    toggleSimulationButton.textContent = running ? "시뮬레이션 일시정지" : "시뮬레이션 시작";
    toggleSimulationButton.setAttribute("aria-pressed", String(running));
}

document.getElementById("start-simulation").addEventListener("click", () => {
    setSimulationRunning(true);
    simulationPrompt.classList.add("hidden");
});

toggleSimulationButton.addEventListener("click", () => {
    setSimulationRunning(!simulationRunning);
});

const panels = [
    { panel: document.getElementById("info"), title: "Blender 3D Model" },
    { panel: document.getElementById("velocity-panel"), title: "오브젝트 속력" }
];

panels.forEach(({ panel, title }) => {
    const toggle = panel.querySelector(".panel-toggle");
    toggle.addEventListener("click", () => {
        const collapsed = panel.classList.toggle("collapsed");
        toggle.textContent = collapsed ? "+" : "−";
        toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.setAttribute("aria-label", `${title} 창 ${collapsed ? "펼치기" : "접기"}`);
    });
});

function selectObject(object) {
    selectedObject = object;
    if (selectionBox) {
        scene.remove(selectionBox);
        selectionBox.geometry.dispose();
        selectionBox = null;
    }

    if (object) {
        const box = new THREE.Box3().setFromObject(object);
        selectionBox = new THREE.Box3Helper(box, 0x67e8f9);
        selectionBox.visible = true;
        scene.add(selectionBox);
    }

    removeObjectButton.disabled = !object;
    if (launchStatus) {
        launchStatus.textContent = object ? "발사 준비 완료" : "선택된 오브젝트 없음";
        launchStatus.className = object ? "launch-status ready" : "launch-status unavailable";
    }
}

function removeSelectedObject() {
    if (!selectedObject) return;
    removePhysicsObject(selectedObject);
}

removeObjectButton.addEventListener("click", removeSelectedObject);

function resetGame() {
    selectObject(null);
    pressedKeys.clear();
    activeDragObject = null;
    controls.enabled = true;
    for (const boom of pendingBooms) {
        removePhysicsObject(boom);
    }
    pendingBooms.length = 0;
    for (const explosion of explosions.splice(0)) {
        scene.remove(explosion.group);
        explosion.group.traverse((child) => {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
            else child.material?.dispose();
        });
    }

    const initialObjects = new Set([objectTemplate, object2Template]);
    for (let i = physicsObjects.length - 1; i >= 0; i--) {
        const object = physicsObjects[i];
        if (!initialObjects.has(object)) {
            removePhysicsObject(object);
        }
    }

    for (const [object] of hitboxLines) {
        if (!physicsObjects.includes(object)) {
            removeHitbox(object);
        }
    }

    if (objectTemplate) {
        objectTemplate.position.set(-10, groundY + draggedSize.y / 2, 0);
        objectTemplate.rotation.set(0, 0, 0);
        objectTemplate.userData.stableTime = 0;
        objectTemplate.userData.groundContact = false;
        objectTemplate.userData.groundContactTime = 0;
        objectTemplate.userData.trampolineContact = false;
        scene.add(objectTemplate);
        if (!physicsObjects.includes(objectTemplate)) {
            registerPhysicsObject(objectTemplate, draggedSize.clone(), draggedVelocity, draggedAngularVelocity, "Object 1");
        }
        draggedVelocity.set(0, 0, 0);
        draggedAngularVelocity.set(0, 0, 0);
        objectTemplate.userData.dragging = false;
    }

    if (object2Template) {
        object2Template.position.set(10, groundY + interactionSize.y / 2, 0);
        object2Template.rotation.set(0, 0, 0);
        object2Template.userData.stableTime = 0;
        object2Template.userData.groundContact = false;
        object2Template.userData.groundContactTime = 0;
        object2Template.userData.trampolineContact = false;
        scene.add(object2Template);
        if (!physicsObjects.includes(object2Template)) {
            registerPhysicsObject(object2Template, interactionSize.clone(), interactionVelocity, interactionAngularVelocity, "Object 2");
        }
        interactionVelocity.set(0, 0, 0);
        interactionAngularVelocity.set(0, 0, 0);
        object2Template.userData.dragging = false;
    }

    draggedObject = objectTemplate;
    interactionObject = object2Template;
    nextObjectId = 3;
    lastLaunchTime = -projectileCooldown;
    interactionActive = false;
    if (statusElement) {
        statusElement.textContent = "";
        statusElement.classList.remove("active");
    }
    launchStatus.textContent = "선택된 오브젝트 없음";
    launchStatus.className = "launch-status unavailable";

    if (trampolineObject && trampolineSize) {
        trampolineObject.position.set(0, groundY + trampolineSize.y / 2, 0);
    }

    const viewSize = Math.max(draggedSize.x, draggedSize.y, draggedSize.z, interactionSize.x, interactionSize.y, interactionSize.z);
    setInitialCameraView(viewSize);
    updateVelocityDisplay();
    setSimulationRunning(false);
    simulationPrompt.classList.remove("hidden");
}

const launchStatus = document.getElementById("launch-status");

function getForwardDirection() {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    if (direction.lengthSq() < 0.001) direction.set(0, 0, -1);
    return direction.normalize();
}

function getPointerLaunchData() {
    raycaster.setFromCamera(pointer, camera);
    const direction = raycaster.ray.direction.clone().normalize();
    const position = raycaster.ray.origin.clone().addScaledVector(direction, 3);
    return { position, direction };
}

function launchBoom() {
    if (!boomTemplate || !boomTemplateSize) {
        if (launchStatus) {
            launchStatus.textContent = "boom 모델 로딩 중";
            launchStatus.className = "launch-status unavailable";
        }
        return;
    }

    const { position, direction } = getPointerLaunchData();
    const boom = boomTemplate.clone(true);
    boom.visible = true;
    boom.position.copy(position);
    boom.rotation.set(0, 0, 0);
    scene.add(boom);

    const size = boomTemplateSize.clone();
    const velocity = direction.clone().multiplyScalar(12);
    const angularVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4
    );
    registerPhysicsObject(boom, size, velocity, angularVelocity, "Boom");
    boom.userData.isBoom = true;
    boom.userData.explosionCountdown = 3;
    pendingBooms.push(boom);
    selectObject(boom);

    launchStatus.textContent = "Boom 발사! 3초 후 폭발";
    launchStatus.className = "launch-status launched";
}

function createExplosion(position) {
    const group = new THREE.Group();
    group.position.copy(position);
    scene.add(group);

    const shockwave = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({
            color: 0xff7a1a,
            transparent: true,
            opacity: 0.75,
            wireframe: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    group.add(shockwave);

    const flash = new THREE.Mesh(
        new THREE.SphereGeometry(1.4, 20, 12),
        new THREE.MeshBasicMaterial({
            color: 0xffffcc,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    group.add(flash);

    const light = new THREE.PointLight(0xff6a00, 18, 25, 2);
    group.add(light);

    const particleCount = 48;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleVelocities = [];
    for (let i = 0; i < particleCount; i++) {
        const direction = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() * 0.9 + 0.1,
            Math.random() - 0.5
        ).normalize();
        particleVelocities.push(direction.multiplyScalar(7 + Math.random() * 10));
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({
            color: 0xff9d3d,
            size: 0.28,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    group.add(particles);

    explosions.push({
        group,
        shockwave,
        flash,
        light,
        particles,
        particleVelocities,
        elapsed: 0,
        duration: 1.4
    });
}

function explodeBoom(boom) {
    const position = boom.position.clone();
    playExplosionSound();
    createExplosion(position);

    const explosionRadius = 10;
    const maxForce = 34;
    for (const object of physicsObjects) {
        if (object === boom || object.userData.fixed) continue;
        const physics = object.userData.physics;
        if (!physics) continue;

        const offset = object.position.clone().sub(position);
        const distance = offset.length();
        if (distance > explosionRadius || distance < 0.001) continue;

        const falloff = 1 - distance / explosionRadius;
        const direction = offset.normalize();
        direction.y = Math.max(direction.y, 0.25);
        direction.normalize();
        physics.velocity.addScaledVector(direction, maxForce * falloff);
        physics.velocity.y += 16 * falloff;
        physics.angularVelocity.x += direction.z * 7 * falloff;
        physics.angularVelocity.z -= direction.x * 7 * falloff;
        object.userData.stableTime = 0;
    }

    removePhysicsObject(boom);
}

function updateBoomsAndExplosions(delta) {
    for (let i = pendingBooms.length - 1; i >= 0; i--) {
        const boom = pendingBooms[i];
        if (!physicsObjects.includes(boom)) {
            pendingBooms.splice(i, 1);
            continue;
        }
        boom.userData.explosionCountdown -= delta;
        if (boom.userData.explosionCountdown <= 0) {
            pendingBooms.splice(i, 1);
            explodeBoom(boom);
        }
    }

    for (let i = explosions.length - 1; i >= 0; i--) {
        const explosion = explosions[i];
        explosion.elapsed += delta;
        const progress = Math.min(explosion.elapsed / explosion.duration, 1);

        const radius = THREE.MathUtils.lerp(0.5, 9, progress);
        explosion.shockwave.scale.setScalar(radius);
        explosion.shockwave.material.opacity = 0.75 * (1 - progress);
        explosion.flash.scale.setScalar(THREE.MathUtils.lerp(1.4, 4.5, progress));
        explosion.flash.material.opacity = 1 - progress;
        explosion.light.intensity = 18 * Math.pow(1 - progress, 3);

        const positions = explosion.particles.geometry.attributes.position.array;
        for (let particleIndex = 0; particleIndex < explosion.particleVelocities.length; particleIndex++) {
            const velocity = explosion.particleVelocities[particleIndex];
            positions[particleIndex * 3] += velocity.x * delta;
            positions[particleIndex * 3 + 1] += velocity.y * delta;
            positions[particleIndex * 3 + 2] += velocity.z * delta;
            velocity.y -= 4.8 * delta;
        }
        explosion.particles.geometry.attributes.position.needsUpdate = true;
        explosion.particles.material.opacity = 1 - progress;

        if (progress >= 1) {
            scene.remove(explosion.group);
            explosion.group.traverse((child) => {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
                else child.material?.dispose();
            });
            explosions.splice(i, 1);
        }
    }
}

function launchObjectForward(object, speed = 14) {
    if (!object?.userData.physics) return;

    const physics = object.userData.physics;
    const direction = getPointerLaunchData().direction;
    object.userData.launched = true;
    object.userData.groundImpact = false;
    object.userData.groundContact = false;
    object.userData.groundContactTime = 0;

    physics.velocity.copy(direction).multiplyScalar(speed);
    physics.angularVelocity.set(
        direction.z * 4 + (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 3,
        -direction.x * 4 + (Math.random() - 0.5) * 1.5
    );
}

function launchSelectedObject() {
    if (!selectedObject) {
        launchStatus.textContent = "선택된 오브젝트 없음";
        launchStatus.className = "launch-status unavailable";
        return;
    }

    const now = performance.now() / 1000;
    const remaining = projectileCooldown - (now - lastLaunchTime);
    if (remaining > 0) {
        launchStatus.textContent = `발사 쿨타임 ${remaining.toFixed(1)}초`;
        launchStatus.className = "launch-status cooldown";
        return;
    }

    launchObjectForward(selectedObject);
    lastLaunchTime = now;
    launchStatus.textContent = "발사!";
    launchStatus.className = "launch-status launched";
}

function updateLaunchStatus() {
    if (!selectedObject || !launchStatus.className.includes("cooldown")) return;
    const remaining = projectileCooldown - (performance.now() / 1000 - lastLaunchTime);
    if (remaining <= 0) {
        launchStatus.textContent = "발사 준비 완료";
        launchStatus.className = "launch-status ready";
    } else {
        launchStatus.textContent = `발사 쿨타임 ${remaining.toFixed(1)}초`;
    }
}

function addObject(spawnInCameraView = false) {
    const template = nextObjectId % 2 === 0 && object2Template ? object2Template : objectTemplate;
    if (!template) return;

    const clone = template.clone(true);
    const sourcePhysics = template.userData.physics;
    const size = sourcePhysics.size.clone();
    const velocity = new THREE.Vector3(0, 0, 0);
    const angularVelocity = new THREE.Vector3(0, 0, 0);

    if (spawnInCameraView) {
        clone.position.copy(getPointerLaunchData().position);
    } else {
        const nominalSpawnSide = nextObjectId % 2 === 0 ? 10 : -10;
        const trampolineClearance = trampolineSize
            ? trampolineSize.x / 2 + size.x / 2 + 1
            : 0;
        const spawnSide = Math.abs(nominalSpawnSide) < trampolineClearance
            ? Math.sign(nominalSpawnSide) * trampolineClearance
            : nominalSpawnSide;
        let supportY = groundY;
        for (const candidate of physicsObjects) {
            const candidatePhysics = candidate.userData.physics;
            if (!candidatePhysics) continue;
            if (candidate.userData.dragging
                || candidatePhysics.velocity.length() > 0.25
                || candidatePhysics.angularVelocity.length() > 0.3
                || !(candidate.userData.contact || candidate.userData.groundContact || candidate.userData.verticalSupport)) {
                continue;
            }

            const candidateQuaternion = new THREE.Quaternion();
            candidate.getWorldQuaternion(candidateQuaternion);
            const candidateAxes = [
                new THREE.Vector3(1, 0, 0).applyQuaternion(candidateQuaternion),
                new THREE.Vector3(0, 1, 0).applyQuaternion(candidateQuaternion),
                new THREE.Vector3(0, 0, 1).applyQuaternion(candidateQuaternion)
            ];
            const half = candidatePhysics.size.clone().multiplyScalar(0.5);
            const horizontalHalfX = half.x * Math.abs(candidateAxes[0].x)
                + half.y * Math.abs(candidateAxes[1].x)
                + half.z * Math.abs(candidateAxes[2].x);
            const horizontalHalfZ = half.x * Math.abs(candidateAxes[0].z)
                + half.y * Math.abs(candidateAxes[1].z)
                + half.z * Math.abs(candidateAxes[2].z);
            if (Math.abs(candidate.position.x - spawnSide) > horizontalHalfX + size.x / 2
                || Math.abs(candidate.position.z) > horizontalHalfZ + size.z / 2) continue;

            supportY = Math.max(
                supportY,
                candidate.position.y + getVerticalHalfExtent(candidate, candidatePhysics.size)
            );
        }
        clone.position.set(spawnSide, supportY + size.y / 2 + 0.015, 0);
    }
    clone.rotation.set(0, 0, 0);
    clone.userData.physics = null;
    scene.add(clone);
    registerPhysicsObject(clone, size, velocity, angularVelocity, `Object ${nextObjectId++}`);
    selectObject(clone);
    launchStatus.textContent = "중앙에 생성됨 — F 키로 발사";
    launchStatus.className = "launch-status ready";
    return clone;
}

function addObjectAndLaunch() {
    const now = performance.now() / 1000;
    const remaining = projectileCooldown - (now - lastLaunchTime);
    if (remaining > 0) {
        launchStatus.textContent = `발사 쿨타임 ${remaining.toFixed(1)}초`;
        launchStatus.className = "launch-status cooldown";
        return;
    }

    if (!objectTemplate) {
        launchStatus.textContent = "오브젝트 로딩 중";
        launchStatus.className = "launch-status unavailable";
        return;
    }

    const clone = addObject(true);
    if (!clone) return;

    launchObjectForward(clone);
    lastLaunchTime = now;
    launchStatus.textContent = "생성 후 발사!";
    launchStatus.className = "launch-status launched";
}

addObjectButton.addEventListener("click", () => addObject());

function updateVelocityDisplay() {
    while (velocityList.children.length > physicsObjects.length) {
        velocityList.lastElementChild.remove();
    }

    physicsObjects.forEach((object, index) => {
        const physics = object.userData.physics;
        const velocity = physics.velocity;
        let row = velocityList.children[index];
        if (!row) {
            row = document.createElement("div");
            row.style.cursor = "pointer";
            velocityList.appendChild(row);
        }
        row.className = `velocity-row${object === selectedObject ? " selected" : ""}`;
        row.textContent = `${physics.id}\n속도 X ${velocity.x.toFixed(2)}  Y ${velocity.y.toFixed(2)}  Z ${velocity.z.toFixed(2)} m/s`;
        row.onclick = () => selectObject(object);
    });
}

function pullSelectedObject(delta) {
    if (!selectedObject || !pressedKeys.has("r")) return;

    const physics = selectedObject.userData.physics;
    if (!physics || selectedObject.userData.dragging) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.normalize();

    const target = camera.position.clone().addScaledVector(forward, 3);
    const towardCamera = target.sub(selectedObject.position);
    const distance = towardCamera.length();
    if (distance < 0.35) {
        physics.velocity.multiplyScalar(0.85);
        return;
    }

    towardCamera.normalize();
    const pullSpeed = THREE.MathUtils.clamp(distance * 4, 4, 14);
    physics.velocity.lerp(towardCamera.multiplyScalar(pullSpeed), THREE.MathUtils.clamp(delta * 8, 0, 1));
    physics.angularVelocity.x += towardCamera.z * delta * 3;
    physics.angularVelocity.z -= towardCamera.x * delta * 3;
}

function moveCamera(delta) {
    if (!pressedKeys.size) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();

    const movement = new THREE.Vector3();
    if (pressedKeys.has("w")) movement.add(forward);
    if (pressedKeys.has("s")) movement.sub(forward);
    if (pressedKeys.has("d")) movement.add(right);
    if (pressedKeys.has("a")) movement.sub(right);

    if (movement.lengthSq()) {
        movement.normalize().multiplyScalar(13.5 * delta);
        camera.position.add(movement);
        controls.target.add(movement);
    }

    if (pressedKeys.has("space") || pressedKeys.has("shift")) {
        const verticalSpeed = 9 * delta;
        const verticalMovement = pressedKeys.has("space") ? verticalSpeed : -verticalSpeed;
        camera.position.y += verticalMovement;
        controls.target.y += verticalMovement;
    }
}

function applyPhysics(object, size, velocity, angularVelocity, delta, dragging) {
    if (!object) return;
    object.updateWorldMatrix(true, false);
    if (dragging) {
        object.userData.stableTime = 0;
        if (object.userData.contact && Math.abs(velocity.y) < 1.2) {
            velocity.y = 0;
            velocity.x *= THREE.MathUtils.clamp(1 - delta * 8, 0, 1);
            velocity.z *= THREE.MathUtils.clamp(1 - delta * 8, 0, 1);
            angularVelocity.x *= THREE.MathUtils.clamp(1 - delta * 12, 0, 1);
            angularVelocity.z *= THREE.MathUtils.clamp(1 - delta * 12, 0, 1);

            if (Math.abs(velocity.x) < 0.02) velocity.x = 0;
            if (Math.abs(velocity.z) < 0.02) velocity.z = 0;
            if (Math.abs(angularVelocity.x) < 0.02) angularVelocity.x = 0;
            if (Math.abs(angularVelocity.z) < 0.02) angularVelocity.z = 0;
        }

        applyAngularRotation(object, angularVelocity, delta);
        angularVelocity.multiplyScalar(Math.pow(0.92, delta * 60));
        return;
    }

    velocity.y = Math.max(
        velocity.y - gravityAcceleration * delta,
        -terminalFallSpeed
    );
    const previousPosition = object.position.clone();
    object.position.addScaledVector(velocity, delta);
    resolveTrampolineCollision(object, object.userData.physics, previousPosition);
    resolveTrampolineLegCollisions(object, object.userData.physics);
    const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    const angularSpeed = Math.sqrt(
        angularVelocity.x * angularVelocity.x
        + angularVelocity.y * angularVelocity.y
        + angularVelocity.z * angularVelocity.z
    );
    const supported = object.userData.contact || object.userData.verticalSupport;
    const isAtRest = supported
        && horizontalSpeed < 0.08
        && Math.abs(velocity.y) < 0.08
        && angularSpeed < 0.08;

    if (isAtRest) {
        velocity.set(
            Math.abs(velocity.x) < 0.02 ? 0 : velocity.x,
            0,
            Math.abs(velocity.z) < 0.02 ? 0 : velocity.z
        );
        angularVelocity.set(
            Math.abs(angularVelocity.x) < 0.02 ? 0 : angularVelocity.x,
            Math.abs(angularVelocity.y) < 0.02 ? 0 : angularVelocity.y,
            Math.abs(angularVelocity.z) < 0.02 ? 0 : angularVelocity.z
        );
        angularVelocity.multiplyScalar(0.75);
    }

    if (object.userData.groundContact && velocity.y < 0) {
        object.userData.groundImpact = true;
    }

    if (object.userData.groundContact && velocity.y < 0) {
        object.userData.groundImpact = true;
    }

    applyAngularRotation(object, angularVelocity, delta);
    angularVelocity.multiplyScalar(Math.pow(0.985, delta * 60));
}

function animate(time) {
    requestAnimationFrame(animate);

    const delta = Math.min((performance.now() - lastPhysicsTime) / 1000, 0.032);
    lastPhysicsTime = performance.now();

    moveCamera(delta);
    controls.update();
    updateDraggedObject();
    if (simulationRunning) {
        pullSelectedObject(delta);
        updateBoomsAndExplosions(delta);

        const substeps = 3;
        const subDelta = delta / substeps;
        for (let substep = 0; substep < substeps; substep++) {
            for (let i = physicsObjects.length - 1; i >= 0; i--) {
                const object = physicsObjects[i];
                const physics = object.userData.physics;
                applyPhysics(object, physics.size, physics.velocity, physics.angularVelocity, subDelta, object.userData.dragging);

                const objectBottom = object.position.y - getVerticalHalfExtent(object, physics.size);
                if (objectBottom < groundY - fallDeleteDepth) {
                    removePhysicsObject(object);
                    continue;
                }
            }
            checkInteraction(subDelta);
        }
    }
    for (const object of physicsObjects) {
        const physics = object.userData.physics;
        if (physics) updateHitbox(object, physics.size);
    }
    setObject2Glow(interactionActive, time);
    if (selectionBox && selectedObject) {
        selectionBox.box.setFromObject(selectedObject);
        selectionBox.updateMatrixWorld(true);
    }
    updateVelocityDisplay();
    updateLaunchStatus();
    renderer.render(scene, camera);
}

animate();