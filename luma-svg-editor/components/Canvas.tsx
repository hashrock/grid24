import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Segment, Point, Tool, HIT_RADIUS, SelectionBox } from '../types';
import { splitSegment, findProjectedT, segmentToSvgPath } from '../utils/bezierHelper';
import { v4 as uuidv4 } from 'uuid';

interface CanvasProps {
  segments: Segment[];
  setSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  tool: Tool;
  gridSize: number;
  selectedNodeIds: Set<string>;
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
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

interface ResizeState {
  handle: ResizeHandleType;
  startPos: Point;
  initialBounds: { minX: number; maxX: number; minY: number; maxY: number };
  initialPoints: Record<string, Point>;
}

const Canvas: React.FC<CanvasProps> = ({ segments, setSegments, tool, gridSize, selectedNodeIds, setSelectedNodeIds }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastDragPos = useRef<Point | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  
  // Pen Tool State
  const [penState, setPenState] = useState<PenState | null>(null);
  
  // Resize State
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

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
      if (e.key === 'Escape') {
        if (tool === Tool.PEN && penState?.isActive) {
          setPenState(null);
        }
        setSelectedNodeIds(new Set());
        setSelectionBox(null);
        setResizeState(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tool, penState, setSelectedNodeIds]);

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

    return {
      x: (clientX - CTM.e) / CTM.a,
      y: (clientY - CTM.f) / CTM.d
    };
  };

  const reflect = (p: Point, center: Point): Point => ({
    x: center.x - (p.x - center.x),
    y: center.y - (p.y - center.y)
  });

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
    const pos = getMousePos(e);
    e.stopPropagation();
    lastDragPos.current = pos;
    
    // 1. Check Resize Handles
    if (showTransform && selectionBounds) {
        const handleSize = 0.6; // Slightly generous hit area
        const handles: { type: ResizeHandleType, x: number, y: number }[] = [
            { type: 'nw', x: selectionBounds.minX, y: selectionBounds.minY },
            { type: 'ne', x: selectionBounds.maxX, y: selectionBounds.minY },
            { type: 'sw', x: selectionBounds.minX, y: selectionBounds.maxY },
            { type: 'se', x: selectionBounds.maxX, y: selectionBounds.maxY },
        ];

        const hitHandle = handles.find(h => Math.hypot(h.x - pos.x, h.y - pos.y) < handleSize);
        if (hitHandle) {
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
            if (Math.hypot(p.val.x - pos.x, p.val.y - pos.y) < HIT_RADIUS) {
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

      if (hitFound) {
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
            
            if (Math.hypot(pos.x - penState.startPoint.x, pos.y - penState.startPoint.y) < HIT_RADIUS) {
                target = penState.startPoint;
                isClosing = true;
            }

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
            setSegments(segments.filter(s => s.id !== hoveredSegmentId));
            setHoveredSegmentId(null);
        }
    }
  };

  const handlePointerMove = (e: React.MouseEvent) => {
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
            setSegments(prev => {
                let updatedSegments = [...prev];
                const pointsToMove = new Set<string>();
                
                selectedNodeIds.forEach(key => {
                    pointsToMove.add(key);
                    const parts = key.split('::');
                    if (parts.length === 2) {
                        const segId = parts[0];
                        const type = parts[1];
                        if (type === 'p1') pointsToMove.add(getPointKey(segId, 'c1'));
                        if (type === 'p2') pointsToMove.add(getPointKey(segId, 'c2'));
                    }
                });

                updatedSegments = updatedSegments.map(seg => {
                    const newSeg = { ...seg };
                    if (pointsToMove.has(getPointKey(seg.id, 'p1'))) newSeg.p1 = { x: newSeg.p1.x + delta.x, y: newSeg.p1.y + delta.y };
                    if (pointsToMove.has(getPointKey(seg.id, 'p2'))) newSeg.p2 = { x: newSeg.p2.x + delta.x, y: newSeg.p2.y + delta.y };
                    if (pointsToMove.has(getPointKey(seg.id, 'c1'))) newSeg.c1 = { x: newSeg.c1.x + delta.x, y: newSeg.c1.y + delta.y };
                    if (pointsToMove.has(getPointKey(seg.id, 'c2'))) newSeg.c2 = { x: newSeg.c2.x + delta.x, y: newSeg.c2.y + delta.y };
                    return newSeg;
                });

                // Mirroring Logic 
                if (selectedNodeIds.size === 1) {
                    const key = Array.from(selectedNodeIds)[0] as string;
                    const parts = key.split('::');
                    if (parts.length === 2) {
                        const segId = parts[0];
                        const type = parts[1];
                        const mainSeg = prev.find(s => s.id === segId);
                        
                        if (mainSeg && (type === 'c1' || type === 'c2')) {
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

                return updatedSegments;
            });
        } else if (tool === Tool.PEN) {
             if (penState?.isDraggingStart) {
                setPenState(prev => prev ? ({ ...prev, outgoingControl: pos }) : null);
            } else if (hoveredSegmentId) {
                setSegments(prev => prev.map(s => {
                    if (s.id !== hoveredSegmentId) return s;
                    return { ...s, c2: reflect(pos, s.p2), isSmoothP2: true };
                }));
                setPenState(prev => prev ? ({ ...prev, outgoingControl: pos }) : null);
            }
        }
    } else {
      if (tool === Tool.SPLIT || tool === Tool.ERASER || tool === Tool.SELECT) {
        let minDist = 2.0;
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
    }
    setPreviewPoint(pos);
  };

  const handlePointerUp = (e: React.MouseEvent) => {
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

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center p-8">
      <div className="relative shadow-2xl shadow-neutral-900 rounded overflow-hidden border border-neutral-800" style={{ height: '80vh', aspectRatio: '1/1' }}>
        <svg
          ref={svgRef}
          viewBox={`-2 -2 ${gridSize + 4} ${gridSize + 4}`}
          className="w-full h-full cursor-crosshair touch-none select-none bg-black"
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
              stroke={hoveredSegmentId === seg.id ? (tool === Tool.ERASER ? '#525252' : '#ffffff') : "white"}
              strokeWidth={hoveredSegmentId === seg.id ? 0.4 : 0.2}
              className="transition-colors duration-75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          
          {penState && tool === Tool.PEN && !isDragging && previewPoint && (
             <path 
                d={`M ${penState.currentPoint.x} ${penState.currentPoint.y} C ${penState.outgoingControl.x} ${penState.outgoingControl.y}, ${previewPoint.x} ${previewPoint.y}, ${previewPoint.x} ${previewPoint.y}`} 
                stroke="white" 
                strokeDasharray="0.2" 
                strokeWidth="0.1" 
                fill="none" 
                opacity="0.5" 
             />
          )}

          {/* Handles */}
          {segments.map(seg => {
             const isHovered = hoveredSegmentId === seg.id;
             const isP1Selected = selectedNodeIds.has(getPointKey(seg.id, 'p1'));
             const isP2Selected = selectedNodeIds.has(getPointKey(seg.id, 'p2'));
             const isC1Selected = selectedNodeIds.has(getPointKey(seg.id, 'c1'));
             const isC2Selected = selectedNodeIds.has(getPointKey(seg.id, 'c2'));

             const showHandles = tool === Tool.SELECT || (tool === Tool.PEN && isHovered);

             if (!showHandles) return null;

             const showC1 = isP1Selected || isC1Selected;
             const showC2 = isP2Selected || isC2Selected;

             return (
               <g key={`handles-${seg.id}`}>
                 {showC1 && <line x1={seg.p1.x} y1={seg.p1.y} x2={seg.c1.x} y2={seg.c1.y} stroke="#444" strokeWidth="0.05" />}
                 {showC2 && <line x1={seg.p2.x} y1={seg.p2.y} x2={seg.c2.x} y2={seg.c2.y} stroke="#444" strokeWidth="0.05" />}
                 
                 {showC1 && <circle cx={seg.c1.x} cy={seg.c1.y} r={0.3} fill={isC1Selected ? "white" : "black"} stroke="white" strokeWidth="0.05" className="cursor-pointer hover:fill-neutral-700"/>}
                 {showC2 && <circle cx={seg.c2.x} cy={seg.c2.y} r={0.3} fill={isC2Selected ? "white" : "black"} stroke="white" strokeWidth="0.05" className="cursor-pointer hover:fill-neutral-700"/>}
                 
                 <rect x={seg.p1.x - 0.2} y={seg.p1.y - 0.2} width={0.4} height={0.4} fill={isP1Selected ? "white" : "black"} stroke="white" strokeWidth="0.05" className="cursor-pointer"/>
                 <rect x={seg.p2.x - 0.2} y={seg.p2.y - 0.2} width={0.4} height={0.4} fill={isP2Selected ? "white" : "black"} stroke="white" strokeWidth="0.05" className="cursor-pointer"/>
               </g>
             )
          })}
          
          {/* Transform Controls */}
          {showTransform && selectionBounds && (
            <g>
                <rect 
                    x={selectionBounds.minX} 
                    y={selectionBounds.minY} 
                    width={selectionBounds.width} 
                    height={selectionBounds.height} 
                    fill="none" 
                    stroke="white" 
                    strokeWidth="0.05" 
                    strokeDasharray="0.2"
                />
                {/* Resize Handles */}
                <rect x={selectionBounds.minX - 0.3} y={selectionBounds.minY - 0.3} width={0.6} height={0.6} fill="white" stroke="black" strokeWidth="0.05" className="cursor-nwse-resize"/>
                <rect x={selectionBounds.maxX - 0.3} y={selectionBounds.minY - 0.3} width={0.6} height={0.6} fill="white" stroke="black" strokeWidth="0.05" className="cursor-nesw-resize"/>
                <rect x={selectionBounds.minX - 0.3} y={selectionBounds.maxY - 0.3} width={0.6} height={0.6} fill="white" stroke="black" strokeWidth="0.05" className="cursor-nesw-resize"/>
                <rect x={selectionBounds.maxX - 0.3} y={selectionBounds.maxY - 0.3} width={0.6} height={0.6} fill="white" stroke="black" strokeWidth="0.05" className="cursor-nwse-resize"/>
            </g>
          )}

          {penState && tool === Tool.PEN && penState.isDraggingStart && (
              <circle cx={penState.startPoint.x} cy={penState.startPoint.y} r={0.3} fill="none" stroke="white" strokeWidth="0.1" />
          )}
          {penState && tool === Tool.PEN && !penState.isDraggingStart && (
               <circle cx={penState.startPoint.x} cy={penState.startPoint.y} r={0.4} fill="none" stroke="white" strokeWidth="0.05" strokeDasharray="0.2"/>
          )}

          {tool === Tool.SPLIT && hoveredSegmentId && previewPoint && (
             <circle cx={previewPoint.x} cy={previewPoint.y} r={0.3} fill="white" opacity={0.5} />
          )}

          {selectionBox && (
              <rect 
                x={Math.min(selectionBox.start.x, selectionBox.end.x)}
                y={Math.min(selectionBox.start.y, selectionBox.end.y)}
                width={Math.abs(selectionBox.end.x - selectionBox.start.x)}
                height={Math.abs(selectionBox.end.y - selectionBox.start.y)}
                fill="white"
                fillOpacity="0.1"
                stroke="white"
                strokeWidth="0.05"
                strokeDasharray="0.2"
              />
          )}

        </svg>
      </div>
      
      {tool === Tool.PEN && penState && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-neutral-500 text-xs bg-neutral-900 px-3 py-1 rounded-full border border-neutral-800 pointer-events-none select-none">
              Press ESC to finish path
          </div>
      )}
    </div>
  );
};

export default Canvas;