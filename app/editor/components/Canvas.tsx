/** @jsxImportSource react */
import type { FC, Dispatch, SetStateAction } from 'react';
import { useRef, useState, useEffect, useMemo } from 'react';
import { Segment, Point, Tool, GRID_SNAP, SelectionBox, PRIMARY_COLOR, ANCHOR_HIT_PX, PATH_HOVER_PX } from '../types';
import { splitSegment, findProjectedT, segmentToSvgPath } from '../utils/bezierHelper';
import { v4 as uuidv4 } from 'uuid';

interface CanvasProps {
  segments: Segment[];
  setSegments: Dispatch<SetStateAction<Segment[]>>;
  tool: Tool;
  gridSize: number;
  selectedNodeIds: Set<string>;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  beginGesture: () => void;
  undo: () => void;
  redo: () => void;
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

const isTypingTarget = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable;
};

const reflect = (p: Point, center: Point): Point => ({
  x: center.x - (p.x - center.x),
  y: center.y - (p.y - center.y)
});

// Translate the selected nodes (anchors carry their attached controls along).
const translateSelection = (segs: Segment[], selection: Set<string>, delta: Point): Segment[] => {
  const pointsToMove = new Set<string>();
  selection.forEach(key => {
    pointsToMove.add(key);
    const [segId, type] = key.split('::');
    if (type === 'p1') pointsToMove.add(`${segId}::c1`);
    if (type === 'p2') pointsToMove.add(`${segId}::c2`);
  });
  return segs.map(seg => {
    const moved = { ...seg };
    let changed = false;
    (['p1', 'c1', 'c2', 'p2'] as const).forEach(t => {
      if (pointsToMove.has(`${seg.id}::${t}`)) {
        moved[t] = { x: moved[t].x + delta.x, y: moved[t].y + delta.y };
        changed = true;
      }
    });
    return changed ? moved : seg;
  });
};

// Reverse the direction of a path given its segments in chain order.
// Junction smoothness travels with the junction: the flag at reversed[j].p2
// is the original flag at the same anchor.
const reversePath = (segs: Segment[]): Segment[] => {
  const n = segs.length;
  return segs.map((_, j) => {
    const o = segs[n - 1 - j];
    return {
      ...o,
      p1: o.p2,
      c1: o.c2,
      c2: o.c1,
      p2: o.p1,
      isSmoothP2: j < n - 1 ? !!segs[n - 2 - j].isSmoothP2 : false,
    };
  });
};

// Toggle smooth/corner for the anchor identified by "segId::p1|p2".
const toggleAnchorSmooth = (segs: Segment[], anchorKey: string): Segment[] => {
  const [segId, type] = anchorKey.split('::');
  const seg = segs.find(s => s.id === segId);
  if (!seg || (type !== 'p1' && type !== 'p2')) return segs;
  const pt = type === 'p1' ? seg.p1 : seg.p2;
  const incoming = segs.find(s => Math.hypot(s.p2.x - pt.x, s.p2.y - pt.y) < 0.001);
  if (!incoming) return segs;
  const makeSmooth = !incoming.isSmoothP2;
  let updated = segs.map(s => s.id === incoming.id ? { ...s, isSmoothP2: makeSmooth } : s);
  if (makeSmooth) {
    const outgoing = updated.find(s => Math.hypot(s.p1.x - pt.x, s.p1.y - pt.y) < 0.001);
    if (outgoing) {
      const mirror = reflect(incoming.c2, pt);
      updated = updated.map(s => s.id === outgoing.id ? { ...s, c1: mirror } : s);
    }
  }
  return updated;
};

interface ResizeState {
  handle: ResizeHandleType;
  startPos: Point;
  initialBounds: { minX: number; maxX: number; minY: number; maxY: number };
  initialPoints: Record<string, Point>;
}

const Canvas: FC<CanvasProps> = ({ segments, setSegments, tool, gridSize, selectedNodeIds, setSelectedNodeIds, beginGesture, undo, redo }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastDragPos = useRef<Point | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  // Open-path endpoint under the cursor in Pen mode (continue / join target)
  const [hoverEndpoint, setHoverEndpoint] = useState<Point | null>(null);
  const lastNudgeAt = useRef(0);

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

  const resetView = () => setViewBox({ x: -2, y: -2, w: gridSize + 4, h: gridSize + 4 });

  useEffect(() => {
    if (tool !== Tool.PEN) {
      setPenState(null);
    }
    if (tool !== Tool.SELECT && tool !== Tool.PEN) {
      setSelectedNodeIds(new Set());
    }
  }, [tool, setSelectedNodeIds]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !isTypingTarget(e) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo();
        else undo();
        // Interaction state may reference segments that no longer exist
        setPenState(null);
        setSelectedNodeIds(new Set());
        return;
      }
      if (e.key === 'Escape') {
        if (tool === Tool.PEN && penState?.isActive) {
          setPenState(null);
        }
        setSelectedNodeIds(new Set());
        setSelectionBox(null);
        setResizeState(null);
      } else if (e.key.startsWith('Arrow') && !isTypingTarget(e) && tool === Tool.SELECT && selectedNodeIds.size > 0) {
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
        // Consecutive nudges within a short window collapse into one undo step
        const now = Date.now();
        if (now - lastNudgeAt.current > 800) beginGesture();
        lastNudgeAt.current = now;
        setSegments(prev => translateSelection(prev, selectedNodeIds, { x: dir.x * step, y: dir.y * step }));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTypingTarget(e)) {
        if (selectedNodeIds.size === 0) return;
        e.preventDefault();
        beginGesture();

        const anchorSegIds = new Set<string>();
        selectedNodeIds.forEach(key => {
          const [segId, type] = key.split('::');
          if (type === 'p1' || type === 'p2') anchorSegIds.add(segId);
        });

        if (anchorSegIds.size > 0) {
          // Deleting an anchor removes its adjoining segments (Illustrator-style);
          // paths that lose a segment are no longer closed.
          setSegments(prev => {
            const brokenPathIds = new Set(
              prev.filter(s => anchorSegIds.has(s.id)).map(s => s.pathId)
            );
            return prev
              .filter(s => !anchorSegIds.has(s.id))
              .map(s => brokenPathIds.has(s.pathId) && s.isClosed ? { ...s, isClosed: false } : s);
          });
        } else {
          // Only control points selected: retract them into their anchors
          setSegments(prev => prev.map(s => {
            let next = s;
            if (selectedNodeIds.has(`${s.id}::c1`)) next = { ...next, c1: { ...next.p1 } };
            if (selectedNodeIds.has(`${s.id}::c2`)) next = { ...next, c2: { ...next.p2 }, isSmoothP2: false };
            return next;
          }));
        }
        setSelectedNodeIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tool, penState, selectedNodeIds, setSegments, setSelectedNodeIds, beginGesture, undo, redo]);

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

  const getPointKey = (segId: string, type: string) => `${segId}::${type}`;

  const getAffectedKeys = (selection: Set<string>) => {
      const affected = new Set<string>();
      selection.forEach(key => {
          affected.add(key);
          const parts = key.split('::');
          if (parts.length === 2) {
              const segId = parts[0];
              const type = parts[1];
              if (type === 'p1') affected.add(getPointKey(segId, 'c1'));
              if (type === 'p2') affected.add(getPointKey(segId, 'c2'));
          }
      });
      return affected;
  };

  const getSelectionBounds = (affectedKeys: Set<string>, currentSegments: Segment[]) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let hasPoints = false;

      currentSegments.forEach(seg => {
          (['p1', 'c1', 'c2', 'p2'] as const).forEach(type => {
              const key = getPointKey(seg.id, type);
              if (affectedKeys.has(key)) {
                  const p = seg[type];
                  minX = Math.min(minX, p.x);
                  maxX = Math.max(maxX, p.x);
                  minY = Math.min(minY, p.y);
                  maxY = Math.max(maxY, p.y);
                  hasPoints = true;
              }
          });
      });

      if (!hasPoints) return null;
      return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  };

  // Memoize bounds for rendering
  const affectedKeys = useMemo(() => getAffectedKeys(selectedNodeIds), [selectedNodeIds, segments]);
  const selectionBounds = useMemo(() => getSelectionBounds(affectedKeys, segments), [affectedKeys, segments]);

  // Paths considered "active": anchors are only rendered for these
  const selectedPathIds = useMemo(() => {
    const ids = new Set<string>();
    selectedNodeIds.forEach(key => {
      const segId = key.split('::')[0];
      const seg = segments.find(s => s.id === segId);
      if (seg) ids.add(seg.pathId);
    });
    return ids;
  }, [selectedNodeIds, segments]);

  const hoveredPathId = useMemo(
    () => segments.find(s => s.id === hoveredSegmentId)?.pathId ?? null,
    [hoveredSegmentId, segments]
  );

  // Free endpoints of open paths (segments are kept in chain order per path).
  // Pen mode uses these to continue an existing path or join two paths.
  const openEndpoints = useMemo(() => {
    const byPath = new Map<string, Segment[]>();
    segments.forEach(s => {
      const list = byPath.get(s.pathId);
      if (list) list.push(s);
      else byPath.set(s.pathId, [s]);
    });
    const eps: { pathId: string; end: 'head' | 'tail'; point: Point }[] = [];
    byPath.forEach((segs, pathId) => {
      if (segs[0].isClosed) return;
      eps.push({ pathId, end: 'head', point: segs[0].p1 });
      eps.push({ pathId, end: 'tail', point: segs[segs.length - 1].p2 });
    });
    return eps;
  }, [segments]);

  // Calculate number of unique anchors involved in selection
  const uniqueSelectedAnchors = useMemo(() => {
      const anchorPositions: Point[] = [];
      selectedNodeIds.forEach(key => {
          const parts = key.split('::');
          if (parts.length === 2) {
              const segId = parts[0];
              const type = parts[1];
              const seg = segments.find(s => s.id === segId);
              if (seg) {
                  // Map any selected node to its Anchor position
                  if (type === 'p1' || type === 'c1') anchorPositions.push(seg.p1);
                  if (type === 'p2' || type === 'c2') anchorPositions.push(seg.p2);
              }
          }
      });

      // Filter unique based on distance (epsilon for float comparison)
      const unique: Point[] = [];
      anchorPositions.forEach(p => {
          if (!unique.some(u => Math.hypot(u.x - p.x, u.y - p.y) < 0.001)) {
              unique.push(p);
          }
      });

      return unique.length;
  }, [selectedNodeIds, segments]);

  const showTransform = tool === Tool.SELECT &&
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
        const handleSize = ANCHOR_HIT_PX * upp;
        const handles: { type: ResizeHandleType, x: number, y: number }[] = [
            { type: 'nw', x: selectionBounds.minX, y: selectionBounds.minY },
            { type: 'ne', x: selectionBounds.maxX, y: selectionBounds.minY },
            { type: 'sw', x: selectionBounds.minX, y: selectionBounds.maxY },
            { type: 'se', x: selectionBounds.maxX, y: selectionBounds.maxY },
        ];

        const hitHandle = handles.find(h => Math.hypot(h.x - pos.x, h.y - pos.y) < handleSize);
        if (hitHandle) {
            beginGesture();
            const initialPoints: Record<string, Point> = {};
            segments.forEach(seg => {
                (['p1', 'c1', 'c2', 'p2'] as const).forEach(t => {
                    const key = getPointKey(seg.id, t);
                    if (affectedKeys.has(key)) {
                        initialPoints[key] = { ...seg[t] };
                    }
                });
            });

            setResizeState({
                handle: hitHandle.type,
                startPos: pos,
                initialBounds: selectionBounds,
                initialPoints
            });
            return;
        }
    }

    if (tool === Tool.SELECT) {
      // Hit Test
      let hitFound = false;
      const hitNodes = new Set<string>();

      for (const seg of segments) {
        const points: Array<{ type: 'p1'|'c1'|'c2'|'p2', val: Point }> = [
          { type: 'p1', val: seg.p1 },
          { type: 'c1', val: seg.c1 },
          { type: 'c2', val: seg.c2 },
          { type: 'p2', val: seg.p2 },
        ];

        for (const p of points) {
          const isAnchor = p.type === 'p1' || p.type === 'p2';
          const isParentSelected = (selectedNodeIds.has(getPointKey(seg.id, 'p1')) && p.type === 'c1') ||
                                   (selectedNodeIds.has(getPointKey(seg.id, 'p2')) && p.type === 'c2');

          if (isAnchor || isParentSelected) {
            if (Math.hypot(p.val.x - pos.x, p.val.y - pos.y) < anchorHitR) {
               hitNodes.add(getPointKey(seg.id, p.type));
               hitFound = true;
               if (isAnchor) {
                   segments.forEach(s => {
                       if (s.id !== seg.id) {
                           if (Math.hypot(s.p1.x - p.val.x, s.p1.y - p.val.y) < 0.01) hitNodes.add(getPointKey(s.id, 'p1'));
                           if (Math.hypot(s.p2.x - p.val.x, s.p2.y - p.val.y) < 0.01) hitNodes.add(getPointKey(s.id, 'p2'));
                       }
                   });
               }
            }
          }
        }
      }

      // Alt+click on an anchor toggles smooth <-> corner (Illustrator-style)
      if (hitFound && e.altKey) {
        const anchorKey = Array.from(hitNodes).find(k => k.endsWith('::p1') || k.endsWith('::p2'));
        if (anchorKey) {
          beginGesture();
          setSegments(prev => toggleAnchorSmooth(prev, anchorKey));
          setSelectedNodeIds(hitNodes);
          return;
        }
      }

      if (hitFound) {
        beginGesture();
        setIsDragging(true);
        if (e.shiftKey) {
            const newSet = new Set(selectedNodeIds);
            hitNodes.forEach(id => {
                if (newSet.has(id)) newSet.delete(id);
                else newSet.add(id);
            });
            setSelectedNodeIds(newSet);
        } else {
            let isClickingSelected = false;
            hitNodes.forEach(id => {
                if (selectedNodeIds.has(id)) isClickingSelected = true;
            });
            if (!isClickingSelected) {
                setSelectedNodeIds(hitNodes);
            }
        }
      } else {
        if (!e.shiftKey) {
            setSelectedNodeIds(new Set());
        }
        setSelectionBox({ start: pos, end: pos });
      }

    } else if (tool === Tool.PEN) {
        if (!penState) {
            // Clicking a free endpoint of an open path continues that path
            const ep = openEndpoints.find(p => Math.hypot(p.point.x - pos.x, p.point.y - pos.y) < anchorHitR);
            if (ep) {
                beginGesture();
                let pathSegs = segments.filter(s => s.pathId === ep.pathId);
                if (ep.end === 'head') {
                    // Continue from the head by reversing the path first
                    pathSegs = reversePath(pathSegs);
                    setSegments(prev => [
                        ...prev.filter(s => s.pathId !== ep.pathId),
                        ...pathSegs,
                    ]);
                }
                const tail = pathSegs[pathSegs.length - 1];
                setPenState({
                    isActive: true,
                    pathId: ep.pathId,
                    startPoint: pathSegs[0].p1,
                    currentPoint: ep.point,
                    outgoingControl: ep.point,
                    isDraggingStart: false
                });
                // Dragging now pulls handles out of the continuation anchor
                setHoveredSegmentId(tail.id);
                setIsDragging(true);
                setSelectedNodeIds(new Set([getPointKey(tail.id, 'p2')]));
                setHoverEndpoint(null);
                return;
            }

            const newPathId = uuidv4();
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
                const ep = openEndpoints.find(p =>
                    p.pathId !== penState.pathId &&
                    Math.hypot(p.point.x - pos.x, p.point.y - pos.y) < anchorHitR);
                if (ep) {
                    beginGesture();
                    const bridge: Segment = {
                        id: uuidv4(),
                        pathId: penState.pathId,
                        p1: penState.currentPoint,
                        c1: penState.outgoingControl,
                        c2: ep.point,
                        p2: ep.point,
                        isSmoothP2: false,
                        isClosed: false
                    };
                    setSegments(prev => {
                        let other = prev.filter(s => s.pathId === ep.pathId);
                        const rest = prev.filter(s => s.pathId !== ep.pathId);
                        if (ep.end === 'tail') other = reversePath(other);
                        return [
                            ...rest,
                            bridge,
                            ...other.map(s => ({ ...s, pathId: penState.pathId })),
                        ];
                    });
                    setPenState(null);
                    setSelectedNodeIds(new Set([getPointKey(bridge.id, 'p2')]));
                    setHoverEndpoint(null);
                    return;
                }
            }

            beginGesture();
            const newSeg: Segment = {
                id: uuidv4(),
                pathId: penState.pathId,
                p1: penState.currentPoint,
                c1: penState.outgoingControl,
                c2: target,
                p2: target,
                isSmoothP2: false,
                isClosed: isClosing
            };

            setSegments(prev => {
                let updated = [...prev, newSeg];
                if (isClosing) {
                    updated = updated.map(s => s.pathId === penState.pathId ? { ...s, isClosed: true } : s);
                }
                return updated;
            });

            setHoveredSegmentId(newSeg.id);
            setIsDragging(true);

            setSelectedNodeIds(new Set([getPointKey(newSeg.id, 'p2')]));

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
        const segment = segments.find(s => s.id === hoveredSegmentId);
        if (segment) {
          beginGesture();
          const { t } = findProjectedT(segment, pos);
          const [s1, s2] = splitSegment(segment, t);
          s1.p1 = segment.p1;
          s2.p2 = segment.p2;

          const mid = { x: s1.p2.x, y: s1.p2.y };
          s1.p2 = mid;
          s2.p1 = mid;

          const idx = segments.findIndex(s => s.id === segment.id);
          const newSegs = [...segments];
          newSegs.splice(idx, 1, s1, s2);
          setSegments(newSegs);
          setHoveredSegmentId(null);
        }
      }
    } else if (tool === Tool.ERASER) {
        if (hoveredSegmentId) {
            beginGesture();
            setSegments(segments.filter(s => s.id !== hoveredSegmentId));
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
        const { handle, initialBounds, initialPoints } = resizeState;

        let newMinX = initialBounds.minX;
        let newMinY = initialBounds.minY;
        let newMaxX = initialBounds.maxX;
        let newMaxY = initialBounds.maxY;

        if (handle.includes('w')) newMinX = pos.x;
        if (handle.includes('e')) newMaxX = pos.x;
        if (handle.includes('n')) newMinY = pos.y;
        if (handle.includes('s')) newMaxY = pos.y;

        const oldW = initialBounds.maxX - initialBounds.minX;
        const oldH = initialBounds.maxY - initialBounds.minY;

        let sx = 1, sy = 1;
        let originX = 0, originY = 0;

        if (handle.includes('w')) {
            originX = initialBounds.maxX;
            sx = (originX - newMinX) / oldW;
        } else {
            originX = initialBounds.minX;
            sx = (newMaxX - originX) / oldW;
        }

        if (handle.includes('n')) {
            originY = initialBounds.maxY;
            sy = (originY - newMinY) / oldH;
        } else {
            originY = initialBounds.minY;
            sy = (newMaxY - originY) / oldH;
        }

        if (Math.abs(oldW) < 0.0001) sx = 1;
        if (Math.abs(oldH) < 0.0001) sy = 1;

        setSegments(prev => prev.map(seg => {
            const newSeg = { ...seg };
            let changed = false;
            (['p1', 'c1', 'c2', 'p2'] as const).forEach(t => {
                 const key = getPointKey(seg.id, t);
                 if (initialPoints[key]) {
                     const p = initialPoints[key];
                     const nx = originX + (p.x - originX) * sx;
                     const ny = originY + (p.y - originY) * sy;
                     newSeg[t] = { x: nx, y: ny };
                     changed = true;
                 }
            });
            return changed ? newSeg : seg;
        }));
        return;
    }

    if (selectionBox) {
        setSelectionBox(prev => prev ? ({ ...prev, end: pos }) : null);
        const xMin = Math.min(selectionBox.start.x, pos.x);
        const xMax = Math.max(selectionBox.start.x, pos.x);
        const yMin = Math.min(selectionBox.start.y, pos.y);
        const yMax = Math.max(selectionBox.start.y, pos.y);

        const newSelection = new Set<string>();
        segments.forEach(seg => {
            if (seg.p1.x >= xMin && seg.p1.x <= xMax && seg.p1.y >= yMin && seg.p1.y <= yMax) {
                newSelection.add(getPointKey(seg.id, 'p1'));
            }
            if (seg.p2.x >= xMin && seg.p2.x <= xMax && seg.p2.y >= yMin && seg.p2.y <= yMax) {
                newSelection.add(getPointKey(seg.id, 'p2'));
            }
        });
        setSelectedNodeIds(newSelection);
        return;
    }

    if (isDragging) {
        const delta = {
            x: pos.x - (lastDragPos.current?.x || pos.x),
            y: pos.y - (lastDragPos.current?.y || pos.y)
        };
        lastDragPos.current = pos;

        if (tool === Tool.SELECT && selectedNodeIds.size > 0) {
            const altKey = e.altKey;
            setSegments(prev => {
                let updatedSegments = translateSelection(prev, selectedNodeIds, delta);

                // Mirroring Logic
                if (selectedNodeIds.size === 1) {
                    const key = Array.from(selectedNodeIds)[0] as string;
                    const parts = key.split('::');
                    if (parts.length === 2) {
                        const segId = parts[0];
                        const type = parts[1];
                        const mainSeg = prev.find(s => s.id === segId);

                        if (mainSeg && (type === 'c1' || type === 'c2')) {
                            if (altKey) {
                                // Alt+drag breaks the handle pair: the anchor becomes a corner
                                if (type === 'c2') {
                                    updatedSegments = updatedSegments.map(seg =>
                                        seg.id === segId ? { ...seg, isSmoothP2: false } : seg);
                                } else {
                                    updatedSegments = updatedSegments.map(seg =>
                                        seg.id !== segId && Math.hypot(seg.p2.x - mainSeg.p1.x, seg.p2.y - mainSeg.p1.y) < 0.001
                                            ? { ...seg, isSmoothP2: false }
                                            : seg);
                                }
                            } else {
                                if (type === 'c2' && mainSeg.isSmoothP2) {
                                    const newC2 = updatedSegments.find(s => s.id === segId)!.c2;
                                    const anchor = updatedSegments.find(s => s.id === segId)!.p2;
                                    updatedSegments = updatedSegments.map(seg => {
                                        if (seg.p1 === mainSeg.p2 || (Math.hypot(seg.p1.x - mainSeg.p2.x, seg.p1.y - mainSeg.p2.y) < 0.001)) {
                                            return { ...seg, c1: reflect(newC2, anchor) };
                                        }
                                        return seg;
                                    });
                                }
                                if (type === 'c1') {
                                    const newC1 = updatedSegments.find(s => s.id === segId)!.c1;
                                    const anchor = updatedSegments.find(s => s.id === segId)!.p1;
                                    updatedSegments = updatedSegments.map(seg => {
                                        if ((seg.p2 === mainSeg.p1 || Math.hypot(seg.p2.x - mainSeg.p1.x, seg.p2.y - mainSeg.p1.y) < 0.001) && seg.isSmoothP2) {
                                            return { ...seg, c2: reflect(newC1, anchor) };
                                        }
                                        return seg;
                                    });
                                }
                            }
                        }
                    }
                }

                return updatedSegments;
            });
        } else if (tool === Tool.PEN) {
             if (penState?.isDraggingStart) {
                setPenState(prev => prev ? ({ ...prev, outgoingControl: pos }) : null);
            } else if (hoveredSegmentId) {
                setSegments(prev => {
                    const seg = prev.find(s => s.id === hoveredSegmentId);
                    if (!seg) return prev;
                    return prev.map(s => {
                        if (s.id === seg.id) return { ...s, c2: reflect(pos, s.p2), isSmoothP2: true };
                        // While closing a path, the start anchor's outgoing
                        // handle (first segment's c1) mirrors the drag too
                        if (seg.isClosed && s.pathId === seg.pathId &&
                            Math.hypot(s.p1.x - seg.p2.x, s.p1.y - seg.p2.y) < 0.001) {
                            return { ...s, c1: { ...pos } };
                        }
                        return s;
                    });
                });
                setPenState(prev => prev ? ({ ...prev, outgoingControl: pos }) : null);
            }
        }
    } else {
      if (tool === Tool.SPLIT || tool === Tool.ERASER || tool === Tool.SELECT) {
        let minDist = PATH_HOVER_PX * upp;
        let closestId = null;
        segments.forEach(seg => {
            const { d } = findProjectedT(seg, pos);
            if (d < minDist) {
                minDist = d;
                closestId = seg.id;
            }
        });
        setHoveredSegmentId(closestId);
      } else {
        setHoveredSegmentId(null);
      }
      if (tool === Tool.PEN) {
        // Highlight continue / join targets (free endpoints of other open paths)
        const ep = openEndpoints.find(p =>
            p.pathId !== penState?.pathId &&
            Math.hypot(p.point.x - pos.x, p.point.y - pos.y) < anchorHitR);
        setHoverEndpoint(ep ? ep.point : null);
      } else if (hoverEndpoint) {
        setHoverEndpoint(null);
      }
    }
    setPreviewPoint(pos);
  };

  const handlePointerUp = (e: React.MouseEvent) => {
    setIsPanning(false);
    lastPanClient.current = null;
    setIsDragging(false);
    setSelectionBox(null);
    setResizeState(null);
    lastDragPos.current = null;

    if (tool === Tool.PEN && penState && !penState.isDraggingStart) {
        const dist = Math.hypot(penState.currentPoint.x - penState.startPoint.x, penState.currentPoint.y - penState.startPoint.y);
        const hasSegments = segments.length > 0;
        if (dist < 0.01 && hasSegments) {
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

  const zoomPercent = Math.round(((gridSize + 4) / viewBox.w) * 100);
  const cursorClass = isPanning ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab' : 'cursor-crosshair';

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className={`w-full h-full ${cursorClass} touch-none select-none bg-black`}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
        >
          {renderGrid()}
          <rect x="0" y="0" width={gridSize} height={gridSize} fill="none" stroke="#404040" strokeWidth="0.1" />

          {/* Paths */}
          {segments.map(seg => (
            <path
              key={seg.id}
              d={segmentToSvgPath(seg)}
              fill="none"
              stroke="white"
              strokeWidth={0.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Active path highlight: thin primary-color overlay at constant screen width */}
          {segments.map(seg => {
            const segmentLevel = tool === Tool.ERASER || tool === Tool.SPLIT;
            const active = segmentLevel
              ? seg.id === hoveredSegmentId
              : seg.pathId === hoveredPathId || selectedPathIds.has(seg.pathId);
            if (!active) return null;
            return (
              <path
                key={`hl-${seg.id}`}
                d={segmentToSvgPath(seg)}
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
          {segments.map(seg => {
             const isP1Selected = selectedNodeIds.has(getPointKey(seg.id, 'p1'));
             const isP2Selected = selectedNodeIds.has(getPointKey(seg.id, 'p2'));
             const isC1Selected = selectedNodeIds.has(getPointKey(seg.id, 'c1'));
             const isC2Selected = selectedNodeIds.has(getPointKey(seg.id, 'c2'));

             // Anchors only appear on selected / hovered paths and the path being drawn
             const pathActive = selectedPathIds.has(seg.pathId) ||
                                seg.pathId === hoveredPathId ||
                                penState?.pathId === seg.pathId;
             const showHandles = (tool === Tool.SELECT || tool === Tool.PEN) && pathActive;

             if (!showHandles) return null;

             const showC1 = isP1Selected || isC1Selected;
             const showC2 = isP2Selected || isC2Selected;

             const a = 3 * upp;   // anchor half-size (6px square on screen)
             const r = 2.5 * upp; // control point radius (5px on screen)
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
            let anchor: Point | null = null;
            let out: Point | null = null;
            if (penState?.isDraggingStart) {
              anchor = penState.startPoint;
              out = penState.outgoingControl;
            } else if (hoveredSegmentId) {
              const seg = segments.find(s => s.id === hoveredSegmentId);
              if (seg) {
                anchor = seg.p2;
                out = reflect(seg.c2, seg.p2);
              }
            }
            if (!anchor || !out || Math.hypot(out.x - anchor.x, out.y - anchor.y) < 0.001) return null;
            const inn = reflect(out, anchor);
            const r = 2.5 * upp;
            const sw = 1 * upp;
            return (
              <g pointerEvents="none">
                <line x1={inn.x} y1={inn.y} x2={out.x} y2={out.y} stroke={PRIMARY_COLOR} strokeWidth={sw} />
                <circle cx={inn.x} cy={inn.y} r={r} fill="white" stroke={PRIMARY_COLOR} strokeWidth={sw} />
                <circle cx={out.x} cy={out.y} r={r} fill={PRIMARY_COLOR} stroke="white" strokeWidth={sw} />
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

      {tool === Tool.PEN && penState && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-neutral-500 text-xs bg-neutral-900 px-3 py-1 rounded-full border border-neutral-800 pointer-events-none select-none">
              Press ESC to finish path
          </div>
      )}
    </div>
  );
};

export default Canvas;
