/** @jsxImportSource react */
import type { FC, Dispatch } from 'react';
import { useRef, useState, useEffect, useMemo } from 'react';
import { Path, Point, Tool, GRID_SNAP, SelectionBox, PRIMARY_COLOR, ANCHOR_HIT_PX, PATH_HOVER_PX, isSelectionTool } from '../types';
import type { RenderStyle } from '../types';
import { findProjectedT, segmentToSvgPath } from '../utils/bezierHelper';
import { pathsToD } from '../../lib/svg';
import { v4 as uuidv4 } from 'uuid';
import {
  EPS,
  NODE_TYPES,
  findPath,
  openEndpoints,
  selectedEndpoints as selectedEndpointsOf,
  pathIdOfSegment,
  placedSegments,
  pointKey,
  reflect,
  reversePath,
  selectedPathIds as selectedPathIdsOf,
  selectionBounds as selectionBoundsOf,
  uniqueSelectedAnchors as uniqueSelectedAnchorsOf,
} from '../state';
import type { Bounds, EditorAction, Endpoint, NodeKey } from '../state';

interface CanvasProps {
  paths: Path[];
  selection: ReadonlySet<NodeKey>;
  dispatch: Dispatch<EditorAction>;
  tool: Tool;
  gridSize: number;
  /** Stroke width / cap / join used for the on-canvas stroke preview. */
  renderStyle: RenderStyle;
  /** Draw the keyline guides under the icon. A view aid, never icon data. */
  showGuides: boolean;
}

interface PenState {
  isActive: boolean;
  pathId: string;
  startPoint: Point;
  currentPoint: Point;
  outgoingControl: Point;
  isDraggingStart: boolean;
}

type ResizeHandleType = 'nw' | 'ne' | 'sw' | 'se';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Zoom limits expressed as viewBox width (smaller = more zoomed in).
const MIN_VIEW_W = 2;
const MAX_VIEW_W = 200;

// Consecutive arrow-key nudges within this window collapse into one undo step.
const NUDGE_MERGE_MS = 800;

// Guide colour: cyan, the usual one for guides, and deliberately not the blue
// accent so a guide never reads as something selected.
const GUIDE_COLOR = '#0891b2';

// A selection can't be scaled below this many grid units. Past zero the shape
// mirrors itself, and at exactly zero the box has no width left to drag back
// out of — the gesture would be unrecoverable without an undo.
const MIN_SCALE_SIZE = 1;

const isTypingTarget = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable;
};

interface ResizeState {
  handle: ResizeHandleType;
  /** Bounds and node positions frozen at pointerdown, so the scale stays
   *  absolute (dragging back to the start restores the original shape). */
  initialBounds: Bounds;
  initialPoints: Record<NodeKey, Point>;
  /** Cursor offset from the corner at pointerdown, so the box doesn't jump. */
  grab: Point;
}

const Canvas: FC<CanvasProps> = ({ paths, selection, dispatch, tool, gridSize, renderStyle, showGuides }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastDragPos = useRef<Point | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  // Open-path endpoint under the cursor in Pen mode (continue / join target)
  const [hoverEndpoint, setHoverEndpoint] = useState<Point | null>(null);
  // Free endpoint a dragged endpoint will weld onto when the drag ends. The
  // ref is what pointerup reads: the last pointermove's state update may not
  // have been rendered yet, and a stale `null` there would drop the join.
  const [joinTarget, setJoinTarget] = useState<Endpoint | null>(null);
  const joinTargetRef = useRef<Endpoint | null>(null);
  const setJoinTargetBoth = (ep: Endpoint | null) => {
    joinTargetRef.current = ep;
    setJoinTarget(ep);
  };

  // --- Undo grouping ---
  // One pointer gesture = one undo step. Every edit dispatched between
  // pointerdown and pointerup carries the same key, and the history layer
  // merges runs that share it. Forgetting to start a gesture costs granularity,
  // never correctness — the edit is still recorded.
  const gestureKey = useRef<string | null>(null);
  const startGesture = () => {
    gestureKey.current = uuidv4();
    return gestureKey.current;
  };
  const currentGesture = () => gestureKey.current ?? undefined;

  const lastNudgeAt = useRef(0);
  const nudgeKey = useRef<string>('');

  // Pen Tool State
  const [penState, setPenState] = useState<PenState | null>(null);

  // Resize State
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  // Viewport (zoom & pan) State
  const [viewBox, setViewBox] = useState<ViewBox>(() => ({ x: -2, y: -2, w: gridSize + 4, h: gridSize + 4 }));
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const lastPanClient = useRef<{ x: number; y: number } | null>(null);

  // Rendered size of the SVG element, to convert screen px -> SVG units
  const [svgSize, setSvgSize] = useState({ w: 1, h: 1 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      setSvgSize({ w: rect.width || 1, h: rect.height || 1 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // SVG user units per screen pixel (preserveAspectRatio "meet" -> max of both axes).
  // Overlay UI (anchors, handles, hit areas) is sized in px * upp so it keeps a
  // constant on-screen size at any zoom level.
  const upp = Math.max(viewBox.w / svgSize.w, viewBox.h / svgSize.h);
  const anchorHitR = ANCHOR_HIT_PX * upp;

  // Free endpoints the selection holds. Two of them is a Join (Cmd+J); one of
  // them is a drag that can weld itself onto another end when it lands.
  const selectedEnds = useMemo(() => selectedEndpointsOf(paths, selection), [paths, selection]);
  const joinable = selectedEnds.length === 2 ? selectedEnds : null;

  const resetView = () => setViewBox({ x: -2, y: -2, w: gridSize + 4, h: gridSize + 4 });

  useEffect(() => {
    if (tool !== Tool.PEN) {
      setPenState(null);
    }
    if (!isSelectionTool(tool) && tool !== Tool.PEN) {
      dispatch({ type: 'selection/clear' });
    }
  }, [tool, dispatch]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !isTypingTarget(e) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'history/redo' : 'history/undo' });
        // The pen draft may reference segments that no longer exist. The
        // selection needs no cleanup: history restores it along with the doc.
        setPenState(null);
        return;
      }
      // Cmd/Ctrl+J welds two selected free endpoints — Illustrator's Join.
      // Two ends of the same path close it.
      if (mod && !isTypingTarget(e) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (joinable) {
          dispatch({
            type: 'path/join',
            id: uuidv4(),
            a: { pathId: joinable[0].pathId, end: joinable[0].end },
            b: { pathId: joinable[1].pathId, end: joinable[1].end },
          });
        }
        return;
      }
      if (e.key === 'Escape') {
        if (tool === Tool.PEN && penState?.isActive) {
          setPenState(null);
        }
        dispatch({ type: 'selection/clear' });
        setSelectionBox(null);
        setResizeState(null);
      } else if (e.key.startsWith('Arrow') && !isTypingTarget(e) && isSelectionTool(tool) && selection.size > 0) {
        const dirs: Record<string, Point> = {
          ArrowLeft: { x: -1, y: 0 },
          ArrowRight: { x: 1, y: 0 },
          ArrowUp: { x: 0, y: -1 },
          ArrowDown: { x: 0, y: 1 },
        };
        const dir = dirs[e.key];
        if (!dir) return;
        e.preventDefault();
        const step = (GRID_SNAP || 0.5) * (e.shiftKey ? 4 : 1);
        const now = Date.now();
        if (now - lastNudgeAt.current > NUDGE_MERGE_MS) nudgeKey.current = uuidv4();
        lastNudgeAt.current = now;
        dispatch({
          type: 'nodes/translate',
          delta: { x: dir.x * step, y: dir.y * step },
          mergeKey: nudgeKey.current,
        });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTypingTarget(e)) {
        if (selection.size === 0) return;
        e.preventDefault();
        dispatch({ type: 'nodes/delete' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tool, penState, selection, joinable, dispatch]);

  // Alt pressed or released mid-drag re-applies the break at the last cursor
  // position. Without this the change would only land on the next pointer move,
  // so holding Alt without moving would look like it did nothing.
  useEffect(() => {
    if (tool !== Tool.PEN || !isDragging || !hoveredSegmentId) return;
    const onAlt = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || e.repeat) return;
      const pos = previewPoint;
      if (!pos) return;
      dispatch({
        type: 'pen/dragHandle',
        segmentId: hoveredSegmentId,
        point: pos,
        break: e.type === 'keydown',
        mergeKey: currentGesture(),
      });
    };
    window.addEventListener('keydown', onAlt);
    window.addEventListener('keyup', onAlt);
    return () => {
      window.removeEventListener('keydown', onAlt);
      window.removeEventListener('keyup', onAlt);
    };
  }, [tool, isDragging, hoveredSegmentId, previewPoint, dispatch]);

  // Space key: hold to pan with drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isTypingTarget(e)) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsPanning(false);
        lastPanClient.current = null;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Wheel zoom centered on the cursor. Native listener because React's
  // onWheel is passive and can't preventDefault (page scroll / browser zoom).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const CTM = svg.getScreenCTM();
      if (!CTM) return;
      // Cursor position in SVG user space (stays fixed while zooming)
      const px = (e.clientX - CTM.e) / CTM.a;
      const py = (e.clientY - CTM.f) / CTM.d;
      // Trackpad pinch arrives as wheel + ctrlKey and feels better amplified
      const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      setViewBox(prev => {
        const w = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, prev.w * factor));
        const scale = w / prev.w;
        return {
          x: px - (px - prev.x) * scale,
          y: py - (py - prev.y) * scale,
          w,
          h: prev.h * scale
        };
      });
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  const getMousePos = (e: React.MouseEvent | React.TouchEvent): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return { x: 0, y: 0 };

    let clientX, clientY;
    if ('touches' in e) {
       clientX = e.touches[0].clientX;
       clientY = e.touches[0].clientY;
    } else {
       clientX = (e as React.MouseEvent).clientX;
       clientY = (e as React.MouseEvent).clientY;
    }

    const raw = {
      x: (clientX - CTM.e) / CTM.a,
      y: (clientY - CTM.f) / CTM.d
    };
    // Snap to the grid so points land on the 24x24 grid like Tabler icons.
    if (GRID_SNAP > 0) {
      return {
        x: Math.round(raw.x / GRID_SNAP) * GRID_SNAP,
        y: Math.round(raw.y / GRID_SNAP) * GRID_SNAP
      };
    }
    return raw;
  };

  // --- Derived views ---
  const placed = useMemo(() => placedSegments(paths), [paths]);
  const affectedPathIds = useMemo(() => selectedPathIdsOf(paths, selection), [paths, selection]);
  const selectionBounds = useMemo(() => selectionBoundsOf(paths, selection), [paths, selection]);
  const uniqueSelectedAnchors = useMemo(
    () => uniqueSelectedAnchorsOf(paths, selection),
    [paths, selection]
  );
  const hoveredPathId = useMemo(
    () => pathIdOfSegment(paths, hoveredSegmentId),
    [paths, hoveredSegmentId]
  );
  const endpoints = useMemo(() => openEndpoints(paths), [paths]);
  // Whole paths (not single segments) — caps and joins only read correctly
  // when a path is drawn as one `d`.
  const previewPaths = useMemo(() => pathsToD(paths), [paths]);

  // How far the closest anchor or handle is. The transform box sits *on* the
  // anchors, so in direct mode a corner anchor would be unreachable if its
  // resize handle always won the hit test — the nearer target takes it.
  const nearestNodeDist = (pos: Point) => {
    let best = Infinity;
    for (const { segment } of placed) {
      for (const t of NODE_TYPES) {
        best = Math.min(best, Math.hypot(segment[t].x - pos.x, segment[t].y - pos.y));
      }
    }
    return best;
  };

  // Segment whose curve passes under `pos` (within the hover tolerance).
  const findSegmentAt = (pos: Point) => {
    let minDist = PATH_HOVER_PX * upp;
    let closest: (typeof placed)[number] | null = null;
    for (const item of placed) {
      const { d } = findProjectedT(item.segment, pos);
      if (d < minDist) {
        minDist = d;
        closest = item;
      }
    }
    return closest;
  };

  const showTransform = isSelectionTool(tool) &&
                        uniqueSelectedAnchors > 1 &&
                        selectionBounds &&
                        (selectionBounds.width > 0 || selectionBounds.height > 0);

  const handlePointerDown = (e: React.MouseEvent) => {
    // Pan: space + drag, or middle mouse button
    if (isSpacePressed || e.button === 1) {
      e.preventDefault(); // Stop middle-click autoscroll
      e.stopPropagation();
      setIsPanning(true);
      lastPanClient.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;

    const pos = getMousePos(e);
    e.stopPropagation();
    lastDragPos.current = pos;

    // 1. Check Resize Handles
    if (showTransform && selectionBounds) {
        const handles: { type: ResizeHandleType, x: number, y: number }[] = [
            { type: 'nw', x: selectionBounds.minX, y: selectionBounds.minY },
            { type: 'ne', x: selectionBounds.maxX, y: selectionBounds.minY },
            { type: 'sw', x: selectionBounds.minX, y: selectionBounds.maxY },
            { type: 'se', x: selectionBounds.maxX, y: selectionBounds.maxY },
        ];

        // Nearest wins: on a small selection all four hit circles overlap, and
        // taking the first match would hand back a corner the cursor isn't on.
        let hitHandle: (typeof handles)[number] | null = null;
        let bestDist = ANCHOR_HIT_PX * upp;
        for (const h of handles) {
            const d = Math.hypot(h.x - pos.x, h.y - pos.y);
            if (d < bestDist) {
                bestDist = d;
                hitHandle = h;
            }
        }
        if (hitHandle && tool === Tool.DIRECT && nearestNodeDist(pos) < bestDist) hitHandle = null;

        if (hitHandle) {
            startGesture();
            const initialPoints: Record<NodeKey, Point> = {};
            for (const { segment } of placed) {
                (['p1', 'c1', 'c2', 'p2'] as const).forEach(t => {
                    // Anchors carry their attached control along, same as a drag.
                    const key = pointKey(segment.id, t);
                    const anchorKey = t === 'c1' ? pointKey(segment.id, 'p1')
                                    : t === 'c2' ? pointKey(segment.id, 'p2')
                                    : key;
                    if (selection.has(key) || selection.has(anchorKey)) {
                        initialPoints[key] = { ...segment[t] };
                    }
                });
            }

            setResizeState({
                handle: hitHandle.type,
                initialBounds: selectionBounds,
                initialPoints,
                grab: { x: pos.x - hitHandle.x, y: pos.y - hitHandle.y },
            });
            return;
        }
    }

    if (tool === Tool.SELECT) {
      // Object mode: the stroke is the only target — anchors aren't exposed,
      // and a hit takes the whole path so it moves and scales as one.
      const hit = findSegmentAt(pos);
      if (hit) {
        startGesture();
        setIsDragging(true);
        dispatch({ type: 'selection/path', pathId: hit.path.id, additive: e.shiftKey });
        return;
      }
      if (!e.shiftKey) dispatch({ type: 'selection/clear' });
      setSelectionBox({ start: pos, end: pos });

    } else if (tool === Tool.DIRECT) {
      // Hit Test
      let hitFound = false;
      const hitNodes = new Set<NodeKey>();

      for (const { segment: seg, path } of placed) {
        const points: Array<{ type: 'p1'|'c1'|'c2'|'p2', val: Point }> = [
          { type: 'p1', val: seg.p1 },
          { type: 'c1', val: seg.c1 },
          { type: 'c2', val: seg.c2 },
          { type: 'p2', val: seg.p2 },
        ];

        for (const p of points) {
          const isAnchor = p.type === 'p1' || p.type === 'p2';
          const isParentSelected = (selection.has(pointKey(seg.id, 'p1')) && p.type === 'c1') ||
                                   (selection.has(pointKey(seg.id, 'p2')) && p.type === 'c2');
          // Handles shown for a whole selected path are grabbable too — except
          // when they sit on their anchor (straight segment), where the anchor wins.
          const anchorOfHandle = p.type === 'c1' ? seg.p1 : seg.p2;
          const isVisibleHandle = !isAnchor &&
                                  affectedPathIds.has(path.id) &&
                                  Math.hypot(p.val.x - anchorOfHandle.x, p.val.y - anchorOfHandle.y) > 0.001;

          if (isAnchor || isParentSelected || isVisibleHandle) {
            if (Math.hypot(p.val.x - pos.x, p.val.y - pos.y) < anchorHitR) {
               hitNodes.add(pointKey(seg.id, p.type));
               hitFound = true;
               if (isAnchor) {
                   for (const { segment: s } of placed) {
                       if (s.id === seg.id) continue;
                       if (Math.hypot(s.p1.x - p.val.x, s.p1.y - p.val.y) < 0.01) hitNodes.add(pointKey(s.id, 'p1'));
                       if (Math.hypot(s.p2.x - p.val.x, s.p2.y - p.val.y) < 0.01) hitNodes.add(pointKey(s.id, 'p2'));
                   }
               }
            }
          }
        }
      }

      // Alt+click on an anchor toggles smooth <-> corner (Illustrator-style)
      if (hitFound && e.altKey) {
        const anchorKey = Array.from(hitNodes).find(k => k.endsWith('::p1') || k.endsWith('::p2'));
        if (anchorKey) {
          dispatch({ type: 'anchor/toggleSmooth', anchorKey, mergeKey: startGesture() });
          dispatch({ type: 'selection/set', keys: hitNodes });
          return;
        }
      }

      if (hitFound) {
        startGesture();
        setIsDragging(true);
        if (e.shiftKey) {
            dispatch({ type: 'selection/toggle', keys: hitNodes });
        } else {
            // Clicking something already selected keeps the wider selection,
            // so a multi-node selection can be dragged as one.
            const isClickingSelected = Array.from(hitNodes).some(id => selection.has(id));
            if (!isClickingSelected) dispatch({ type: 'selection/set', keys: hitNodes });
        }
      } else {
        // Clicking the stroke takes that one segment (Illustrator-style): its
        // two anchors, so the segment can be dragged on its own.
        const hit = findSegmentAt(pos);
        if (hit) {
            startGesture();
            setIsDragging(true);
            dispatch({ type: 'selection/segment', segmentId: hit.segment.id, additive: e.shiftKey });
            return;
        }

        if (!e.shiftKey) {
            dispatch({ type: 'selection/clear' });
        }
        setSelectionBox({ start: pos, end: pos });
      }

    } else if (tool === Tool.PEN) {
        if (!penState) {
            // Clicking a free endpoint of an open path continues that path
            const ep = endpoints.find(p => Math.hypot(p.point.x - pos.x, p.point.y - pos.y) < anchorHitR);
            if (ep) {
                const gesture = startGesture();
                let path = findPath(paths, ep.pathId);
                if (!path) return;
                if (ep.end === 'head') {
                    // Continue from the head by reversing the path first.
                    // reversePath keeps ids, so the local copy stays in sync.
                    path = reversePath(path);
                    dispatch({ type: 'path/reverse', pathId: ep.pathId, mergeKey: gesture });
                }
                const tail = path.segments[path.segments.length - 1];
                setPenState({
                    isActive: true,
                    pathId: ep.pathId,
                    startPoint: path.segments[0].p1,
                    currentPoint: ep.point,
                    outgoingControl: ep.point,
                    isDraggingStart: false
                });
                // Dragging now pulls handles out of the continuation anchor
                setHoveredSegmentId(tail.id);
                setIsDragging(true);
                dispatch({ type: 'selection/set', keys: [pointKey(tail.id, 'p2')] });
                setHoverEndpoint(null);
                return;
            }

            const newPathId = uuidv4();
            startGesture();
            setPenState({
                isActive: true,
                pathId: newPathId,
                startPoint: pos,
                currentPoint: pos,
                outgoingControl: pos,
                isDraggingStart: true
            });
            setIsDragging(true);
        } else {
            let target = pos;
            let isClosing = false;

            if (Math.hypot(pos.x - penState.startPoint.x, pos.y - penState.startPoint.y) < anchorHitR) {
                target = penState.startPoint;
                isClosing = true;
            } else {
                // Clicking a free endpoint of ANOTHER open path joins the two paths
                const ep = endpoints.find(p =>
                    p.pathId !== penState.pathId &&
                    Math.hypot(p.point.x - pos.x, p.point.y - pos.y) < anchorHitR);
                if (ep) {
                    dispatch({
                        type: 'pen/join',
                        id: uuidv4(),
                        pathId: penState.pathId,
                        from: penState.currentPoint,
                        control: penState.outgoingControl,
                        target: ep,
                        mergeKey: startGesture(),
                    });
                    setPenState(null);
                    setHoverEndpoint(null);
                    return;
                }
            }

            const newSegId = uuidv4();
            dispatch({
                type: 'pen/commit',
                id: newSegId,
                pathId: penState.pathId,
                from: penState.currentPoint,
                control: penState.outgoingControl,
                to: target,
                closing: isClosing,
                mergeKey: startGesture(),
            });

            setHoveredSegmentId(newSegId);
            setIsDragging(true);

            if (isClosing) {
                setPenState(null);
            } else {
                setPenState(prev => prev ? {
                    ...prev,
                    currentPoint: target,
                    outgoingControl: target,
                    isDraggingStart: false
                } : null);
            }
        }
    } else if (tool === Tool.SPLIT) {
       if (hoveredSegmentId) {
        const hit = placed.find(item => item.segment.id === hoveredSegmentId);
        if (hit) {
          const { t } = findProjectedT(hit.segment, pos);
          dispatch({
            type: 'segment/split',
            segmentId: hit.segment.id,
            t,
            ids: [uuidv4(), uuidv4()],
            mergeKey: startGesture(),
          });
          setHoveredSegmentId(null);
        }
      }
    } else if (tool === Tool.ERASER) {
        if (hoveredSegmentId) {
            dispatch({ type: 'segment/erase', segmentId: hoveredSegmentId, mergeKey: startGesture() });
            setHoveredSegmentId(null);
        }
    }
  };

  const handlePointerMove = (e: React.MouseEvent) => {
    if (isPanning && lastPanClient.current) {
      const CTM = svgRef.current?.getScreenCTM();
      if (CTM) {
        const dx = (e.clientX - lastPanClient.current.x) / CTM.a;
        const dy = (e.clientY - lastPanClient.current.y) / CTM.d;
        setViewBox(prev => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
      }
      lastPanClient.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const pos = getMousePos(e);

    if (resizeState) {
        const { handle, initialBounds, initialPoints, grab } = resizeState;

        const oldW = initialBounds.maxX - initialBounds.minX;
        const oldH = initialBounds.maxY - initialBounds.minY;

        // The dragged corner moves; the opposite corner stays put and is the
        // origin the whole selection scales around.
        const west = handle.includes('w');
        const north = handle.includes('n');
        const origin = {
            x: west ? initialBounds.maxX : initialBounds.minX,
            y: north ? initialBounds.maxY : initialBounds.minY,
        };

        // Clamping the corner rather than the ratio stops the box at its
        // minimum size and stops it flipping through the origin in one step.
        // A selection already thinner than the minimum keeps its own size as
        // the floor, so grabbing it doesn't inflate it on the first pixel.
        const stop = (v: number, o: number, min: number, before: boolean) =>
            before ? Math.min(v, o - min) : Math.max(v, o + min);
        // Subtracting the grab offset keeps the corner under the same part of
        // the cursor it was picked up by, so the shape never jumps.
        const corner = {
            x: stop(pos.x - grab.x, origin.x, Math.min(MIN_SCALE_SIZE, oldW), west),
            y: stop(pos.y - grab.y, origin.y, Math.min(MIN_SCALE_SIZE, oldH), north),
        };

        // A selection with no extent on an axis has no direction to scale in.
        const sx = oldW < EPS ? 1 : (west ? origin.x - corner.x : corner.x - origin.x) / oldW;
        const sy = oldH < EPS ? 1 : (north ? origin.y - corner.y : corner.y - origin.y) / oldH;

        dispatch({
            type: 'nodes/scale',
            origin,
            sx,
            sy,
            from: initialPoints,
            // Anchors land back on the grid, like every other edit does.
            snap: GRID_SNAP,
            mergeKey: currentGesture(),
        });
        return;
    }

    if (selectionBox) {
        setSelectionBox(prev => prev ? ({ ...prev, end: pos }) : null);
        dispatch({
            type: 'selection/box',
            min: { x: Math.min(selectionBox.start.x, pos.x), y: Math.min(selectionBox.start.y, pos.y) },
            max: { x: Math.max(selectionBox.start.x, pos.x), y: Math.max(selectionBox.start.y, pos.y) },
            mode: tool === Tool.SELECT ? 'paths' : 'nodes',
        });
        return;
    }

    if (isDragging) {
        const delta = {
            x: pos.x - (lastDragPos.current?.x || pos.x),
            y: pos.y - (lastDragPos.current?.y || pos.y)
        };
        lastDragPos.current = pos;

        if (isSelectionTool(tool) && selection.size > 0) {
            dispatch({
                type: 'nodes/translate',
                delta,
                // Handle pairs only matter when a single handle is being dragged,
                // which object mode never does — it moves whole paths rigidly.
                // Alt breaks a smooth junction instead of mirroring across it.
                mirror: tool === Tool.DIRECT ? (e.altKey ? 'break' : 'follow') : 'none',
                mergeKey: currentGesture(),
            });
            // Dragging a single free end: highlight the end it will weld onto.
            // The cursor is the probe, not the anchor — `paths` still holds the
            // pre-dispatch position at this point.
            const target = tool === Tool.DIRECT && selectedEnds.length === 1
                ? endpoints.find(ep =>
                    !selection.has(ep.key) &&
                    Math.hypot(ep.point.x - pos.x, ep.point.y - pos.y) < anchorHitR)
                : undefined;
            setJoinTargetBoth(target ?? null);
        } else if (tool === Tool.PEN) {
             if (penState?.isDraggingStart) {
                setPenState(prev => prev ? ({ ...prev, outgoingControl: pos }) : null);
            } else if (hoveredSegmentId) {
                dispatch({
                    type: 'pen/dragHandle',
                    segmentId: hoveredSegmentId,
                    point: pos,
                    // Alt decouples the incoming handle: "straight in, curve out".
                    break: e.altKey,
                    mergeKey: currentGesture(),
                });
                setPenState(prev => prev ? ({ ...prev, outgoingControl: pos }) : null);
            }
        }
    } else {
      if (tool === Tool.SPLIT || tool === Tool.ERASER || isSelectionTool(tool)) {
        setHoveredSegmentId(findSegmentAt(pos)?.segment.id ?? null);
      } else {
        setHoveredSegmentId(null);
      }
      if (tool === Tool.PEN) {
        // Highlight continue / join targets (free endpoints of other open paths)
        const ep = endpoints.find(p =>
            p.pathId !== penState?.pathId &&
            Math.hypot(p.point.x - pos.x, p.point.y - pos.y) < anchorHitR);
        setHoverEndpoint(ep ? ep.point : null);
      } else if (hoverEndpoint) {
        setHoverEndpoint(null);
      }
    }
    setPreviewPoint(pos);
  };

  const handlePointerUp = () => {
    // Dropping a dragged endpoint onto another free end welds the two. It
    // carries the drag's merge key, so the move and the join undo as one.
    const weld = joinTargetRef.current;
    if (isDragging && weld && selectedEnds.length === 1) {
      dispatch({
        type: 'path/join',
        id: uuidv4(),
        a: { pathId: selectedEnds[0].pathId, end: selectedEnds[0].end },
        b: { pathId: weld.pathId, end: weld.end },
        at: weld.point,
        mergeKey: currentGesture(),
      });
    }
    setJoinTargetBoth(null);
    setIsPanning(false);
    lastPanClient.current = null;
    setIsDragging(false);
    setSelectionBox(null);
    setResizeState(null);
    lastDragPos.current = null;
    gestureKey.current = null;

    if (tool === Tool.PEN && penState && !penState.isDraggingStart) {
        const dist = Math.hypot(penState.currentPoint.x - penState.startPoint.x, penState.currentPoint.y - penState.startPoint.y);
        if (dist < 0.01 && placed.length > 0) {
            setPenState(null);
        }
    }
  };

  const renderGrid = () => {
    const lines = [];
    for (let i = 0; i <= gridSize; i++) {
      lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={gridSize} stroke="#262626" strokeWidth="0.05" />);
      lines.push(<line key={`h${i}`} x1={0} y1={i} x2={gridSize} y2={i} stroke="#262626" strokeWidth="0.05" />);
    }
    return <g>{lines}</g>;
  };

  /**
   * Keyline guides: the shapes an icon set aligns to so a square, a circle and
   * a bar read as the same size. Everything is derived from `gridSize` so the
   * proportions hold if the canvas ever stops being 24 units.
   */
  const renderGuides = () => {
    const u = gridSize / 24;
    const inset = (n: number) => ({
      x: n * u,
      y: n * u,
      width: gridSize - 2 * n * u,
      height: gridSize - 2 * n * u,
    });
    return (
      <g pointerEvents="none" fill="none" stroke={GUIDE_COLOR} strokeWidth={0.07 * u} opacity={0.7}>
        {/* Live area (20x20): the icon should not reach past it. */}
        <rect {...inset(2)} strokeDasharray={`${0.5 * u} ${0.5 * u}`} opacity={0.8} />
        {/* Keyline square (18x18), circle (d20), and the two bars (16x20 / 20x16). */}
        <rect {...inset(3)} />
        <circle cx={gridSize / 2} cy={gridSize / 2} r={10 * u} />
        <rect x={4 * u} y={2 * u} width={16 * u} height={20 * u} rx={u} />
        <rect x={2 * u} y={4 * u} width={20 * u} height={16 * u} rx={u} />
      </g>
    );
  };

  const zoomPercent = Math.round(((gridSize + 4) / viewBox.w) * 100);
  const cursorClass = isPanning ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab' : 'cursor-crosshair';

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className={`w-full h-full ${cursorClass} touch-none select-none bg-black`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {renderGrid()}
          <rect x="0" y="0" width={gridSize} height={gridSize} fill="none" stroke="#404040" strokeWidth="0.1" />
          {showGuides && renderGuides()}

          {/* Stroke preview: the icon as it actually renders, at the current
              width / cap / join. Dimmed so the skeleton and handles stay readable. */}
          <g pointerEvents="none" opacity={0.35}>
            {previewPaths.map((d, i) => (
              <path
                key={`preview-${i}`}
                d={d}
                fill="none"
                stroke="white"
                strokeWidth={renderStyle.strokeWidth}
                strokeLinecap={renderStyle.strokeLinecap}
                strokeLinejoin={renderStyle.strokeLinejoin}
              />
            ))}
          </g>

          {/* Paths */}
          {placed.map(({ segment }) => (
            <path
              key={segment.id}
              d={segmentToSvgPath(segment)}
              fill="none"
              stroke="white"
              strokeWidth={0.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Active path highlight: thin primary-color overlay at constant screen width */}
          {placed.map(({ segment, path }) => {
            const segmentLevel = tool === Tool.ERASER || tool === Tool.SPLIT;
            const active = segmentLevel
              ? segment.id === hoveredSegmentId
              : path.id === hoveredPathId || affectedPathIds.has(path.id);
            if (!active) return null;
            return (
              <path
                key={`hl-${segment.id}`}
                d={segmentToSvgPath(segment)}
                fill="none"
                stroke={tool === Tool.ERASER ? '#ef4444' : PRIMARY_COLOR}
                strokeWidth={1.5 * upp}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {penState && tool === Tool.PEN && !isDragging && previewPoint && (
             <path
                d={`M ${penState.currentPoint.x} ${penState.currentPoint.y} C ${penState.outgoingControl.x} ${penState.outgoingControl.y}, ${previewPoint.x} ${previewPoint.y}, ${previewPoint.x} ${previewPoint.y}`}
                stroke={PRIMARY_COLOR}
                strokeDasharray={`${3 * upp}`}
                strokeWidth={1 * upp}
                fill="none"
                opacity="0.8"
             />
          )}

          {/* Handles */}
          {placed.map(({ segment: seg, path }) => {
             const isP1Selected = selection.has(pointKey(seg.id, 'p1'));
             const isP2Selected = selection.has(pointKey(seg.id, 'p2'));
             const isC1Selected = selection.has(pointKey(seg.id, 'c1'));
             const isC2Selected = selection.has(pointKey(seg.id, 'c2'));

             // Anchors only appear on selected / hovered paths and the path being drawn
             const pathActive = affectedPathIds.has(path.id) ||
                                path.id === hoveredPathId ||
                                penState?.pathId === path.id;
             // Object mode hides anchors and handles: there is nothing to grab.
             const showHandles = (tool === Tool.DIRECT || tool === Tool.PEN) && pathActive;

             if (!showHandles) return null;

             // A selected path shows every anchor's handles at once (like
             // Illustrator); hovering alone only reveals the anchors.
             const pathSelected = affectedPathIds.has(path.id);
             const showC1 = pathSelected || isP1Selected || isC1Selected;
             const showC2 = pathSelected || isP2Selected || isC2Selected;

             const a = 4 * upp;   // anchor half-size (8px square on screen)
             const r = 3.5 * upp; // control point radius (7px on screen)
             const sw = 1 * upp;  // 1px stroke

             return (
               <g key={`handles-${seg.id}`}>
                 {showC1 && <line x1={seg.p1.x} y1={seg.p1.y} x2={seg.c1.x} y2={seg.c1.y} stroke={PRIMARY_COLOR} strokeWidth={sw} />}
                 {showC2 && <line x1={seg.p2.x} y1={seg.p2.y} x2={seg.c2.x} y2={seg.c2.y} stroke={PRIMARY_COLOR} strokeWidth={sw} />}

                 {showC1 && <circle cx={seg.c1.x} cy={seg.c1.y} r={r} fill={isC1Selected ? PRIMARY_COLOR : 'white'} stroke={isC1Selected ? 'white' : PRIMARY_COLOR} strokeWidth={sw} className="cursor-pointer"/>}
                 {showC2 && <circle cx={seg.c2.x} cy={seg.c2.y} r={r} fill={isC2Selected ? PRIMARY_COLOR : 'white'} stroke={isC2Selected ? 'white' : PRIMARY_COLOR} strokeWidth={sw} className="cursor-pointer"/>}

                 <rect x={seg.p1.x - a} y={seg.p1.y - a} width={a * 2} height={a * 2} fill={isP1Selected ? PRIMARY_COLOR : 'white'} stroke={isP1Selected ? 'white' : PRIMARY_COLOR} strokeWidth={sw} className="cursor-pointer"/>
                 <rect x={seg.p2.x - a} y={seg.p2.y - a} width={a * 2} height={a * 2} fill={isP2Selected ? PRIMARY_COLOR : 'white'} stroke={isP2Selected ? 'white' : PRIMARY_COLOR} strokeWidth={sw} className="cursor-pointer"/>
               </g>
             )
          })}

          {/* Pen drag: live preview of the handle pair being pulled out */}
          {tool === Tool.PEN && isDragging && (() => {
            // The two handles are drawn independently, not as a mirrored pair:
            // once Alt breaks them apart they no longer line up.
            let anchor: Point | null = null;
            let out: Point | null = null;
            let inn: Point | null = null;
            if (penState?.isDraggingStart) {
              anchor = penState.startPoint;
              out = penState.outgoingControl;
              inn = reflect(out, anchor); // no incoming segment yet — phantom
            } else if (hoveredSegmentId) {
              const seg = placed.find(item => item.segment.id === hoveredSegmentId)?.segment;
              if (seg) {
                anchor = seg.p2;
                inn = seg.c2;
                out = penState?.outgoingControl ?? reflect(seg.c2, seg.p2);
              }
            }
            if (!anchor || !out || !inn) return null;
            const grown = (p: Point) => Math.hypot(p.x - anchor!.x, p.y - anchor!.y) >= 0.001;
            if (!grown(out) && !grown(inn)) return null;
            const r = 3.5 * upp;
            const sw = 1 * upp;
            return (
              <g pointerEvents="none">
                {grown(inn) && <line x1={anchor.x} y1={anchor.y} x2={inn.x} y2={inn.y} stroke={PRIMARY_COLOR} strokeWidth={sw} />}
                {grown(out) && <line x1={anchor.x} y1={anchor.y} x2={out.x} y2={out.y} stroke={PRIMARY_COLOR} strokeWidth={sw} />}
                {grown(inn) && <circle cx={inn.x} cy={inn.y} r={r} fill="white" stroke={PRIMARY_COLOR} strokeWidth={sw} />}
                {grown(out) && <circle cx={out.x} cy={out.y} r={r} fill={PRIMARY_COLOR} stroke="white" strokeWidth={sw} />}
              </g>
            );
          })()}

          {/* Transform Controls */}
          {showTransform && selectionBounds && (
            <g>
                <rect
                    x={selectionBounds.minX}
                    y={selectionBounds.minY}
                    width={selectionBounds.width}
                    height={selectionBounds.height}
                    fill="none"
                    stroke={PRIMARY_COLOR}
                    strokeWidth={1 * upp}
                />
                {/* Resize Handles */}
                {[
                  { x: selectionBounds.minX, y: selectionBounds.minY, cls: 'cursor-nwse-resize' },
                  { x: selectionBounds.maxX, y: selectionBounds.minY, cls: 'cursor-nesw-resize' },
                  { x: selectionBounds.minX, y: selectionBounds.maxY, cls: 'cursor-nesw-resize' },
                  { x: selectionBounds.maxX, y: selectionBounds.maxY, cls: 'cursor-nwse-resize' },
                ].map((h, i) => (
                  <rect key={i} x={h.x - 3.5 * upp} y={h.y - 3.5 * upp} width={7 * upp} height={7 * upp} fill="white" stroke={PRIMARY_COLOR} strokeWidth={1 * upp} className={h.cls}/>
                ))}
            </g>
          )}

          {penState && tool === Tool.PEN && penState.isDraggingStart && (
              <circle cx={penState.startPoint.x} cy={penState.startPoint.y} r={4 * upp} fill="none" stroke={PRIMARY_COLOR} strokeWidth={1.5 * upp} />
          )}
          {penState && tool === Tool.PEN && !penState.isDraggingStart && (() => {
              // Highlight the start point when the cursor is close enough to close the path
              const near = previewPoint &&
                  Math.hypot(previewPoint.x - penState.startPoint.x, previewPoint.y - penState.startPoint.y) < anchorHitR;
              return (
                  <circle
                      cx={penState.startPoint.x}
                      cy={penState.startPoint.y}
                      r={near ? 6 * upp : 4 * upp}
                      fill={near ? PRIMARY_COLOR : 'none'}
                      fillOpacity={near ? 0.4 : 0}
                      stroke={PRIMARY_COLOR}
                      strokeWidth={1 * upp}
                      strokeDasharray={near ? undefined : `${2 * upp}`}
                  />
              );
          })()}

          {/* Weld target: the free endpoint a dragged endpoint will join onto */}
          {joinTarget && (
             <circle
                cx={joinTarget.point.x}
                cy={joinTarget.point.y}
                r={6 * upp}
                fill={PRIMARY_COLOR}
                fillOpacity={0.4}
                stroke={PRIMARY_COLOR}
                strokeWidth={1 * upp}
             />
          )}

          {/* Continue / join target: free endpoint of an open path under the pen */}
          {tool === Tool.PEN && hoverEndpoint && !isDragging && (
             <circle
                cx={hoverEndpoint.x}
                cy={hoverEndpoint.y}
                r={6 * upp}
                fill={PRIMARY_COLOR}
                fillOpacity={0.4}
                stroke={PRIMARY_COLOR}
                strokeWidth={1 * upp}
             />
          )}

          {tool === Tool.SPLIT && hoveredSegmentId && previewPoint && (
             <circle cx={previewPoint.x} cy={previewPoint.y} r={3 * upp} fill={PRIMARY_COLOR} opacity={0.8} />
          )}

          {selectionBox && (
              <rect
                x={Math.min(selectionBox.start.x, selectionBox.end.x)}
                y={Math.min(selectionBox.start.y, selectionBox.end.y)}
                width={Math.abs(selectionBox.end.x - selectionBox.start.x)}
                height={Math.abs(selectionBox.end.y - selectionBox.start.y)}
                fill={PRIMARY_COLOR}
                fillOpacity="0.12"
                stroke={PRIMARY_COLOR}
                strokeWidth={1 * upp}
              />
          )}

        </svg>

      {/* Zoom indicator / reset */}
      <button
        onClick={resetView}
        title="Reset view"
        className="absolute bottom-4 right-4 text-neutral-400 text-xs bg-neutral-900 px-3 py-1 rounded-full border border-neutral-800 hover:text-white hover:border-neutral-600 select-none"
      >
        {zoomPercent}%
      </button>

      {/* An empty grid gave no clue how to start; say so until the first stroke. */}
      {paths.length === 0 && !penState && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-xs rounded-xl border border-neutral-800 bg-neutral-950/90 px-5 py-4 text-center text-xs leading-relaxed text-neutral-400 shadow-xl">
            {tool === Tool.PEN ? (
              <>
                <p className="mb-1 text-sm font-medium text-white">キャンバスは空です</p>
                <p>
                  クリックして点を打つと線が引けます。<br />
                  描き終わったら <kbd className="rounded border border-neutral-700 px-1 font-mono text-neutral-300">Esc</kbd> で確定。
                </p>
                <p className="mt-2 text-neutral-500">
                  一から描かないなら、パネルの「検索して追加」で既存のアイコンを取り込めます。
                </p>
              </>
            ) : (
              <>
                <p className="mb-1 text-sm font-medium text-white">まだ線がありません</p>
                <p>
                  描くにはツールの「ペン」を選んでください。<br />
                  既存のアイコンを取り込むなら「検索して追加」。
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {tool === Tool.PEN && penState && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 text-neutral-500 text-xs bg-neutral-900 px-3 py-1 rounded-full border border-neutral-800 pointer-events-none select-none">
              <span>ESC で確定</span>
              <span className="text-neutral-700">·</span>
              <span>ドラッグ中 <kbd className="font-mono text-neutral-400">Alt</kbd> でコーナー</span>
          </div>
      )}
    </div>
  );
};

export default Canvas;
