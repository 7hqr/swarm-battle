const MAP_LAYOUT = {
  leftBaseXRatio: 0.1125,
  baseYRatio: 0.5,
  leftCoreXRatio: 0.2,
  leftCoreYRatio: 0.4205,
  leftTechXRatio: 0.1969,
  leftTechYRatio: 0.5852,
  leftAdvancedPositions: [
    { xRatio: 0.2844, yRatio: 0.4318 },
    { xRatio: 0.2813, yRatio: 0.5909 }
  ]
};

const DEFAULT_TERRAIN_NAVIGATION_CELL_SIZE = 48;
const CONTROL_STRUCTURE_RADIUS_RATIO = 0.1;
const SYMMETRIC_TERRAIN_LAYOUT = {
  leftSideBlockers: [
    { kind: "circle", xRatio: 0.18, yRatio: 0.32, radiusRatio: 0.055 },
    { kind: "circle", xRatio: 0.18, yRatio: 0.68, radiusRatio: 0.055 },
    { kind: "circle", xRatio: 0.27, yRatio: 0.24, radiusRatio: 0.045 },
    { kind: "circle", xRatio: 0.27, yRatio: 0.76, radiusRatio: 0.045 },
    { kind: "rect", xRatio: 0.295, yRatio: 0.405, widthRatio: 0.035, heightRatio: 0.19 }
  ],
  centerBlockers: [
    { kind: "rect", xRatio: 0.43, yRatio: 0.07, widthRatio: 0.032, heightRatio: 0.25 },
    { kind: "rect", xRatio: 0.43, yRatio: 0.43, widthRatio: 0.032, heightRatio: 0.18 },
    { kind: "rect", xRatio: 0.538, yRatio: 0.21, widthRatio: 0.032, heightRatio: 0.18 },
    { kind: "rect", xRatio: 0.538, yRatio: 0.68, widthRatio: 0.032, heightRatio: 0.25 }
  ]
};

export const mapDefinitions = [
  createSymmetricMap("small_map", "Small", 2400, 1360),
  createSymmetricMap("medium_map", "Medium", 3200, 1760),
  createSymmetricMap("large_map", "Large", 4200, 2310)
];

export const mapsById = Object.fromEntries(
  mapDefinitions.map((definition) => [definition.id, definition])
);

export const defaultMapId = "medium_map";
export const defaultMap = mapsById[defaultMapId];

function createSymmetricMap(id, displayName, width, height) {
  const leftStart = createPlayerStart(1, width, height, false);
  const rightStart = createPlayerStart(2, width, height, true);

  return {
    id,
    displayName,
    width,
    height,
    playerStarts: [leftStart, rightStart],
    objectives: createMapObjectives(width, height),
    terrain: {
      navigationCellSize: DEFAULT_TERRAIN_NAVIGATION_CELL_SIZE,
      blockers: createSymmetricTerrainBlockers(width, height)
    }
  };
}

function createPlayerStart(playerId, width, height, mirrored) {
  const base = createPoint(MAP_LAYOUT.leftBaseXRatio, MAP_LAYOUT.baseYRatio, width, height, mirrored);
  const coreProduction = createPoint(
    MAP_LAYOUT.leftCoreXRatio,
    MAP_LAYOUT.leftCoreYRatio,
    width,
    height,
    mirrored
  );
  const techSlots = [
    createPoint(MAP_LAYOUT.leftTechXRatio, MAP_LAYOUT.leftTechYRatio, width, height, mirrored)
  ];
  const advancedSlots = MAP_LAYOUT.leftAdvancedPositions.map(({ xRatio, yRatio }) => {
    return createPoint(xRatio, yRatio, width, height, mirrored);
  });

  return {
    playerId,
    base,
    coreProduction,
    techSlots,
    advancedSlots
  };
}

function createPoint(xRatio, yRatio, width, height, mirrored) {
  const x = mirrored ? width - width * xRatio : width * xRatio;
  return {
    x: Math.round(x),
    y: Math.round(height * yRatio)
  };
}

function createSymmetricTerrainBlockers(width, height) {
  const blockers = [];

  for (const blocker of SYMMETRIC_TERRAIN_LAYOUT.leftSideBlockers) {
    blockers.push(createTerrainBlocker(blocker, width, height, false));
    blockers.push(createTerrainBlocker(blocker, width, height, true));
  }

  for (const blocker of SYMMETRIC_TERRAIN_LAYOUT.centerBlockers) {
    blockers.push(createTerrainBlocker(blocker, width, height, false));
  }

  return blockers;
}

function createMapObjectives(width, height) {
  return {
    richCellPockets: [
      createRichCellPocket("safe_left", 0.22, 0.5, width, height, false),
      createRichCellPocket("safe_right", 0.22, 0.5, width, height, true),
      createRichCellPocket("contested_top", 0.5, 0.34, width, height, false),
      createRichCellPocket("contested_bottom", 0.5, 0.66, width, height, false)
    ],
    controlStructures: [
      {
        id: "move_speed_beacon",
        displayName: "Move Speed Beacon",
        shortLabel: "Move +5%",
        center: createPoint(0.5, 0.5, width, height, false),
        radius: Math.round(Math.min(width, height) * CONTROL_STRUCTURE_RADIUS_RATIO),
        captureRate: 0.03,
        bonus: {
          kind: "global_move_speed",
          value: 0.05
        }
      }
    ]
  };
}

function createRichCellPocket(id, xRatio, yRatio, width, height, mirrored) {
  return {
    id,
    center: createPoint(xRatio, yRatio, width, height, mirrored)
  };
}

function createTerrainBlocker(blocker, width, height, mirrored) {
  if (blocker.kind === "circle") {
    const x = mirrored ? width - width * blocker.xRatio : width * blocker.xRatio;
    return {
      kind: "circle",
      x: Math.round(x),
      y: Math.round(height * blocker.yRatio),
      radius: Math.round(Math.min(width, height) * blocker.radiusRatio)
    };
  }

  if (blocker.kind === "rect") {
    const blockerWidth = Math.round(width * blocker.widthRatio);
    const x = mirrored
      ? width - width * blocker.xRatio - blockerWidth
      : width * blocker.xRatio;
    return {
      kind: "rect",
      x: Math.round(x),
      y: Math.round(height * blocker.yRatio),
      width: blockerWidth,
      height: Math.round(height * blocker.heightRatio)
    };
  }

  throw new Error(`Unsupported terrain blocker kind: ${blocker.kind}`);
}
