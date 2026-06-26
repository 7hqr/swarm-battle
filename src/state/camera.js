const CAMERA_EDGE_OVERSCROLL_MAP_RATIO = 0.3;
const CAMERA_EDGE_OVERSCROLL_VIEW_RATIO = 1.1;

export function setViewportSize(state, width, height, devicePixelRatio = 1) {
  state.viewport.width = width;
  state.viewport.height = height;
  state.viewport.devicePixelRatio = devicePixelRatio;
  if (!state.map) {
    state.camera.zoom = 1;
    state.camera.x = 0;
    state.camera.y = 0;
    return;
  }
  state.camera.zoom = clamp(state.camera.zoom, getCameraMinZoom(state), getCameraMaxZoom());
  clampCamera(state);
}

export function setViewportPadding(state, padding) {
  const nextPadding = {
    left: Math.max(0, padding.left),
    right: Math.max(0, padding.right),
    top: Math.max(0, padding.top),
    bottom: Math.max(0, padding.bottom)
  };

  if (
    state.viewport.padding.left === nextPadding.left &&
    state.viewport.padding.right === nextPadding.right &&
    state.viewport.padding.top === nextPadding.top &&
    state.viewport.padding.bottom === nextPadding.bottom
  ) {
    return;
  }

  if (!state.map) {
    state.viewport.padding.left = nextPadding.left;
    state.viewport.padding.right = nextPadding.right;
    state.viewport.padding.top = nextPadding.top;
    state.viewport.padding.bottom = nextPadding.bottom;
    return;
  }

  const previousFocusPoint = getViewportFocusPoint(state);
  const anchorBeforePaddingChange = screenToWorld(state, previousFocusPoint);

  state.viewport.padding.left = nextPadding.left;
  state.viewport.padding.right = nextPadding.right;
  state.viewport.padding.top = nextPadding.top;
  state.viewport.padding.bottom = nextPadding.bottom;
  state.camera.zoom = clamp(state.camera.zoom, getCameraMinZoom(state), getCameraMaxZoom());
  const anchorAfterPaddingChange = screenToWorld(state, previousFocusPoint);
  state.camera.x += anchorBeforePaddingChange.x - anchorAfterPaddingChange.x;
  state.camera.y += anchorBeforePaddingChange.y - anchorAfterPaddingChange.y;
  clampCamera(state);
}

export function getCameraMinZoom(state) {
  if (!state.map) {
    return 1;
  }
  const usableWidth = getUsableViewportWidth(state);
  const usableHeight = getUsableViewportHeight(state);
  return Math.min(1, Math.min(usableWidth / state.map.width, usableHeight / state.map.height) * 0.65);
}

export function getCameraMaxZoom() {
  return 2.4;
}

export function setCameraToMapOverview(state) {
  if (!state.map) {
    state.camera.x = 0;
    state.camera.y = 0;
    state.camera.zoom = 1;
    return;
  }
  state.camera.x = state.map.width * 0.5;
  state.camera.y = state.map.height * 0.5;
  state.camera.zoom = getCameraMinZoom(state);
  clampCamera(state);
}

export function setCameraCenter(state, x, y) {
  if (!state.map) {
    return;
  }
  state.camera.x = x;
  state.camera.y = y;
  clampCamera(state);
}

export function clampCamera(state) {
  if (!state.map) {
    return;
  }
  const halfVisibleWidth = getUsableViewportWidth(state) / (2 * state.camera.zoom);
  const halfVisibleHeight = getUsableViewportHeight(state) / (2 * state.camera.zoom);
  const horizontalEdgePadding = Math.min(
    state.map.width * CAMERA_EDGE_OVERSCROLL_MAP_RATIO,
    halfVisibleWidth * CAMERA_EDGE_OVERSCROLL_VIEW_RATIO
  );
  const verticalEdgePadding = Math.min(
    state.map.height * CAMERA_EDGE_OVERSCROLL_MAP_RATIO,
    halfVisibleHeight * CAMERA_EDGE_OVERSCROLL_VIEW_RATIO
  );

  if (halfVisibleWidth >= state.map.width * 0.5 + horizontalEdgePadding) {
    state.camera.x = state.map.width * 0.5;
  } else {
    state.camera.x = clamp(
      state.camera.x,
      halfVisibleWidth - horizontalEdgePadding,
      state.map.width - halfVisibleWidth + horizontalEdgePadding
    );
  }

  if (halfVisibleHeight >= state.map.height * 0.5 + verticalEdgePadding) {
    state.camera.y = state.map.height * 0.5;
  } else {
    state.camera.y = clamp(
      state.camera.y,
      halfVisibleHeight - verticalEdgePadding,
      state.map.height - halfVisibleHeight + verticalEdgePadding
    );
  }
}

export function screenToWorld(state, point) {
  const focusPoint = getViewportFocusPoint(state);
  return {
    x: state.camera.x + (point.x - focusPoint.x) / state.camera.zoom,
    y: state.camera.y + (point.y - focusPoint.y) / state.camera.zoom
  };
}

export function panCameraByScreenDelta(state, deltaX, deltaY) {
  state.camera.x -= deltaX / state.camera.zoom;
  state.camera.y -= deltaY / state.camera.zoom;
  clampCamera(state);
}

export function zoomCameraAtScreenPoint(state, targetZoom, screenPoint) {
  const zoom = clamp(targetZoom, getCameraMinZoom(state), getCameraMaxZoom());
  const anchorBeforeZoom = screenToWorld(state, screenPoint);
  state.camera.zoom = zoom;
  const anchorAfterZoom = screenToWorld(state, screenPoint);
  state.camera.x += anchorBeforeZoom.x - anchorAfterZoom.x;
  state.camera.y += anchorBeforeZoom.y - anchorAfterZoom.y;
  clampCamera(state);
}

export function getViewportFocusPoint(state) {
  return {
    x: state.viewport.padding.left + getUsableViewportWidth(state) * 0.5,
    y: state.viewport.padding.top + getUsableViewportHeight(state) * 0.5
  };
}

export function getVisibleWorldBounds(state, padding = 0) {
  const halfVisibleWidth = getUsableViewportWidth(state) / (2 * state.camera.zoom);
  const halfVisibleHeight = getUsableViewportHeight(state) / (2 * state.camera.zoom);

  return {
    left: state.camera.x - halfVisibleWidth - padding,
    right: state.camera.x + halfVisibleWidth + padding,
    top: state.camera.y - halfVisibleHeight - padding,
    bottom: state.camera.y + halfVisibleHeight + padding
  };
}

function getUsableViewportWidth(state) {
  return Math.max(1, state.viewport.width - state.viewport.padding.left - state.viewport.padding.right);
}

function getUsableViewportHeight(state) {
  return Math.max(1, state.viewport.height - state.viewport.padding.top - state.viewport.padding.bottom);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
