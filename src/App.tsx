import React, { useState, useCallback, useMemo } from 'react';
import { 
  Wrench, 
  Upload, 
  Pencil, 
  Trash2, 
  FlipHorizontal, 
  Share2, 
  ZoomIn as ZoomInIcon, 
  ZoomOut as ZoomOutIcon, 
  Grid3X3, 
  Undo2, 
  Save as SaveIcon,
  Palette as PaletteIcon,
  PlusCircle,
  HelpCircle,
  Settings as SettingsIcon,
  Target,
  Download,
  Lock,
  Unlock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { processImage, type PixelData } from './utils/imageProcessing';
import { mergeStrayBeads } from './utils/gridProcessing';
import { BEAD_COLORS_221, BEAD_COLORS_291, type BeadColor } from './constants/beadColors';

export default function App() {
  const [grid, setGrid] = useState<PixelData[][]>([]);
  const [rawGrid, setRawGrid] = useState<PixelData[][]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isFlipped, setIsFlipped] = useState(false);
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null);
  const [isGridVisible, setIsGridVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'project' | 'view'>('view');
  const [beadState, setBeadState] = useState<'placed' | 'melted'>('placed');
  const [paletteType, setPaletteType] = useState<'221' | '291'>('221');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [resolution, setResolution] = useState({ width: 32, height: 32 });
  const [templateSize, setTemplateSize] = useState(32); // Default 5*6 + 2 = 32
  const [subjectOffset, setSubjectOffset] = useState({ x: 0, y: 0 });
  const [subjectSize, setSubjectSize] = useState({ width: 0, height: 0 });
  const [imageScale, setImageScale] = useState(1);
  const [joystickSpeedCmPerSec, setJoystickSpeedCmPerSec] = useState(10);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffsetStart, setDragOffsetStart] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<'pan' | 'drag' | 'pipette'>('pan');
  const [saturation, setSaturation] = useState(1.2);
  const [contrast, setContrast] = useState(1.15);
  const [minSize, setMinSize] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [originalImage, setOriginalImage] = useState<File | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(true); // Mocking for now

  // Initialize with a sample pattern (all white)
  React.useEffect(() => {
    const initialGrid: PixelData[][] = [];
    const white = BEAD_COLORS_221.find(c => c.id === 'H1') || BEAD_COLORS_221[0];

    for (let y = 0; y < templateSize; y++) {
      const row: PixelData[] = [];
      for (let x = 0; x < templateSize; x++) {
        row.push({ color: white, x, y });
      }
      initialGrid.push(row);
    }
    setGrid(initialGrid);
    setResolution({ width: templateSize, height: templateSize });
  }, [templateSize]);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const joystickRef = React.useRef<HTMLDivElement>(null);
  const joystickKnobRef = React.useRef<HTMLDivElement>(null);
  const joystickVectorRef = React.useRef({ x: 0, y: 0 });
  const joystickActiveRef = React.useRef(false);

  React.useEffect(() => {
    const boardEl = boardRef.current;
    if (!boardEl) return;

    const onWheel = (e: WheelEvent) => {
      // Only zoom when the pointer is over the board area.
      if (!(e.target instanceof Node) || !boardEl.contains(e.target)) return;

      // Prevent page/parent scrolling while zooming the board.
      e.preventDefault();

      const step = 0.1;
      // Requirement: wheel down => zoom in, wheel up => zoom out
      const nextDelta = e.deltaY > 0 ? step : -step;
      setZoom((z) => Math.min(3, Math.max(0.5, z + nextDelta)));
    };

    boardEl.addEventListener('wheel', onWheel, { passive: false });
    return () => boardEl.removeEventListener('wheel', onWheel);
  }, []);

  React.useEffect(() => {
    const baseEl = joystickRef.current;
    const knobEl = joystickKnobRef.current;
    if (!baseEl || !knobEl) return;

    const radius = 34;
    const deadZone = 6;

    const setVectorFromPointer = (clientX: number, clientY: number) => {
      const rect = baseEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;

      const dist = Math.hypot(dx, dy);
      if (dist < deadZone) {
        knobEl.style.transform = 'translate(0px, 0px)';
        joystickVectorRef.current = { x: 0, y: 0 };
        return;
      }

      const nx = dx / dist;
      const ny = dy / dist;
      const uiDist = Math.min(dist, radius);
      const uiDx = nx * uiDist;
      const uiDy = ny * uiDist;

      knobEl.style.transform = `translate(${uiDx}px, ${uiDy}px)`;
      joystickVectorRef.current = { x: nx, y: ny };
    };

    const reset = () => {
      knobEl.style.transform = 'translate(0px, 0px)';
      joystickVectorRef.current = { x: 0, y: 0 };
      joystickActiveRef.current = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      joystickActiveRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setVectorFromPointer(e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!joystickActiveRef.current) return;
      setVectorFromPointer(e.clientX, e.clientY);
    };
    const onPointerUp = () => reset();

    baseEl.addEventListener('pointerdown', onPointerDown);
    baseEl.addEventListener('pointermove', onPointerMove);
    baseEl.addEventListener('pointerup', onPointerUp);
    baseEl.addEventListener('pointercancel', onPointerUp);

    return () => {
      baseEl.removeEventListener('pointerdown', onPointerDown);
      baseEl.removeEventListener('pointermove', onPointerMove);
      baseEl.removeEventListener('pointerup', onPointerUp);
      baseEl.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  React.useEffect(() => {
    let raf = 0;
    let lastTs = 0;
    let carryX = 0;
    let carryY = 0;
    const tick = () => {
      const v = joystickVectorRef.current;
      const dirX = v.x;
      const dirY = v.y;

      const now = performance.now();
      const dt = lastTs === 0 ? 0 : (now - lastTs) / 1000;
      lastTs = now;

      const boardEdgeCm = 26;
      const speedCmPerSec = joystickSpeedCmPerSec;
      const cmPerCell = boardEdgeCm / Math.max(1, templateSize);
      const speedCellsPerSec = speedCmPerSec / cmPerCell;

      if (dirX !== 0 || dirY !== 0) {
        carryX += dirX * speedCellsPerSec * dt;
        carryY += dirY * speedCellsPerSec * dt;

        const stepX = Math.trunc(carryX);
        const stepY = Math.trunc(carryY);

        if (stepX !== 0 || stepY !== 0) {
          carryX -= stepX;
          carryY -= stepY;
          setSubjectOffset((o) => ({ x: o.x + stepX, y: o.y + stepY }));
        }
      } else {
        carryX = 0;
        carryY = 0;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [templateSize, joystickSpeedCmPerSec]);

  // Draw grid to canvas
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || grid.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellW = canvas.width / resolution.width;
    const cellH = canvas.height / resolution.height;
    
    // Ensure cells are square by taking the minimum dimension
    const cellSize = Math.min(cellW, cellH);
    const offsetX = (canvas.width - cellSize * resolution.width) / 2;
    const offsetY = (canvas.height - cellSize * resolution.height) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const displayGrid = showOriginal ? rawGrid : grid;
    
    displayGrid.forEach((row, y) => {
      row.forEach((pixel, x) => {
        if (!pixel || !pixel.color) return;
        
        // Force Reset in Drawing: If sliding, ignore isolation/filters
        const isProjectMode = activeTab === 'project';
        const isIsolated = !isSliding && isProjectMode && selectedColorId && pixel.color.id !== selectedColorId;
        
        // Highlight noise pixels when sliding
        const isNoisePixel = !showOriginal && isSliding && rawGrid[y][x].color.id !== grid[y][x].color.id;
        
        const drawX = offsetX + x * cellSize;
        const drawY = offsetY + y * cellSize;

        if (isNoisePixel) {
          // Flash effect: use a distinct highlight, ignore all other filters
          const pulse = (Math.sin(Date.now() / 150) + 1) / 2;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + pulse * 0.5})`;
          ctx.fillRect(drawX, drawY, cellSize, cellSize);
        } else {
          // In "color search" isolation: show other colors as white (but keep underlying data unchanged).
          ctx.fillStyle = isIsolated ? '#FFFFFF' : pixel.color.hex;
          ctx.globalAlpha = 1.0;
          
          // Always fill the background square first to prevent gaps
          ctx.fillRect(drawX, drawY, cellSize, cellSize);
          
          if (beadState === 'placed') {
            // Draw circle for 'placed' state on top of the square background
            ctx.beginPath();
            const centerX = drawX + cellSize / 2;
            const centerY = drawY + cellSize / 2;
            const radius = (cellSize / 2) * (isIsolated ? 0.5 : 0.9);
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Add a subtle bead outline and center "hole" (also for isolated white cells).
            ctx.strokeStyle = isIsolated ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.2)';
            ctx.stroke();

            const dr = isIsolated ? 255 : pixel.color.r;
            const dg = isIsolated ? 255 : pixel.color.g;
            const db = isIsolated ? 255 : pixel.color.b;
            const brightness = (dr * 299 + dg * 587 + db * 114) / 1000;

            ctx.beginPath();
            ctx.fillStyle = brightness < 110 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)';
            ctx.arc(centerX, centerY, radius * 0.28, 0, Math.PI * 2);
            ctx.fill();

            // Restore fillStyle for next cell
            ctx.fillStyle = isIsolated ? '#FFFFFF' : pixel.color.hex;
          }
        }
      });
    });

    // Draw 5x5 Template Grid Lines
    if (isGridVisible) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = Math.max(1, cellSize * 0.1);
      
      // Vertical lines starting from index 1, every 5 pixels
      for (let i = 1; i < resolution.width; i += 5) {
        const x = offsetX + i * cellSize;
        ctx.beginPath();
        ctx.moveTo(x, offsetY);
        ctx.lineTo(x, offsetY + resolution.height * cellSize);
        ctx.stroke();
      }
      
      // Horizontal lines starting from index 1, every 5 pixels
      for (let j = 1; j < resolution.height; j += 5) {
        const y = offsetY + j * cellSize;
        ctx.beginPath();
        ctx.moveTo(offsetX, y);
        ctx.lineTo(offsetX + resolution.width * cellSize, y);
        ctx.stroke();
      }
    }

    // Apply melted filters if needed
    if (beadState === 'melted') {
      // Note: Canvas filters are better applied via CSS for performance in real-time
    }
  }, [grid, resolution, selectedColorId, activeTab, beadState]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTab !== 'project' || grid.length === 0) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const cellW = rect.width / resolution.width;
    const cellH = rect.height / resolution.height;
    const cellSize = Math.min(cellW, cellH);
    const offsetX = (rect.width - cellSize * resolution.width) / 2;
    const offsetY = (rect.height - cellSize * resolution.height) / 2;

    const gridX = Math.floor((x - offsetX) / cellSize);
    const gridY = Math.floor((y - offsetY) / cellSize);

    if (grid[gridY] && grid[gridY][gridX]) {
      const pixel = grid[gridY][gridX];
      setSelectedColorId(pixel.color.id);
    }
  };

  // Inventory calculation
  const inventory = useMemo(() => {
    const counts: Record<string, { color: BeadColor; count: number }> = {};
    grid.flat().forEach((pixel) => {
      if (!pixel || !pixel.color) return;
      if (!counts[pixel.color.id]) {
        counts[pixel.color.id] = { color: pixel.color, count: 0 };
      }
      counts[pixel.color.id].count++;
    });
    return Object.values(counts).sort((a, b) => b.count - a.count);
  }, [grid]);

  // 1. Core Image Processing (Raw Pixelation)
  React.useEffect(() => {
    if (!originalImage) return;

    const runProcessing = async () => {
      setIsLoading(true);
      try {
        // Image size is user-controlled (keeps original aspect ratio).
        const base = Math.max(1, Math.round(templateSize * imageScale));
        let targetW: number;
        let targetH: number;
        if (aspectRatio && aspectRatio > 1) {
          targetW = base;
          targetH = Math.max(1, Math.round(base / aspectRatio));
        } else if (aspectRatio) {
          targetH = base;
          targetW = Math.max(1, Math.round(base * aspectRatio));
        } else {
          targetW = base;
          targetH = base;
        }

        // Guardrails to avoid accidentally huge processing.
        const maxDim = 600;
        if (targetW > maxDim || targetH > maxDim) {
          const scale = maxDim / Math.max(targetW, targetH);
          targetW = Math.max(1, Math.round(targetW * scale));
          targetH = Math.max(1, Math.round(targetH * scale));
        }

        const processed = await processImage(
          originalImage, 
          targetW, 
          targetH, 
          saturation, 
          contrast, 
          false, 
          false,
          paletteType
        );
        
        setSubjectSize({ width: targetW, height: targetH });
        
        // Initial centering (can be negative if image larger than board).
        const startX = Math.floor((templateSize - targetW) / 2);
        const startY = Math.floor((templateSize - targetH) / 2);
        setSubjectOffset({ x: startX, y: startY });

        setRawGrid(processed);
        setResolution({ width: templateSize, height: templateSize });
      } catch (err) {
        console.error('Processing failed:', err);
      } finally {
        setIsLoading(false);
      }
    };

    runProcessing();
  }, [originalImage, templateSize, imageScale, saturation, contrast, paletteType, aspectRatio]);

  // 2. Noise Reduction & Grid Assembly (Post-processing)
  React.useEffect(() => {
    if (rawGrid.length === 0) return;
    
    // Force Reset: When minSize changes or sliding starts, we ensure we're working with clean data
    if (isSliding) {
      setSelectedColorId(null);
    }

    let processedSubject = rawGrid;
    if (minSize > 1) {
      processedSubject = mergeStrayBeads(rawGrid, minSize);
    }

    // Note: avoid forcing bright highlights to white/blank; handled in image pre-processing.

    // Assemble the final grid by placing the subject on the board
    const finalGrid: PixelData[][] = [];
    const white = (paletteType === '221' ? BEAD_COLORS_221 : BEAD_COLORS_291).find(c => c.id === 'H1') || BEAD_COLORS_221[0];

    for (let y = 0; y < templateSize; y++) {
      const row: PixelData[] = [];
      for (let x = 0; x < templateSize; x++) {
        const subX = x - subjectOffset.x;
        const subY = y - subjectOffset.y;

        if (subX >= 0 && subX < subjectSize.width && subY >= 0 && subY < subjectSize.height) {
          const pixel = processedSubject[subY][subX];
          row.push({ ...pixel, x, y });
        } else {
          row.push({ color: white, x, y });
        }
      }
      finalGrid.push(row);
    }

    setGrid(finalGrid);
  }, [rawGrid, minSize, isSliding, subjectOffset, subjectSize, templateSize, paletteType]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width / img.height;
        setAspectRatio(ratio);
        setOriginalImage(file); // This will trigger the useEffect
      };
      img.src = URL.createObjectURL(file);
    }
    // Allow re-uploading the same file (input won't fire change otherwise).
    e.target.value = '';
  };

  const updateResolution = useCallback((w: number) => {
    if (isLocked) return;
    let h = resolution.height;
    if (aspectRatio) {
      h = Math.round(w / aspectRatio);
    }
    setResolution({ width: w, height: h });
  }, [isLocked, aspectRatio, resolution.height]);

  const updateFilters = useCallback((s: number, c: number) => {
    setSaturation(s);
    setContrast(c);
  }, []);

  const updatePalette = useCallback((type: '221' | '291') => {
    setPaletteType(type);
  }, []);

  const handleExportPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const html2canvas = (await import('html2canvas')).default;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgData = canvas.toDataURL('image/png');
    
    pdf.text('拼豆图纸 (Bead Pixel Pro Pattern)', 10, 10);
    pdf.addImage(imgData, 'PNG', 10, 20, 190, 190);
    
    // Add legend
    let y = 220;
    pdf.setFontSize(8);
    inventory.forEach((item, i) => {
      if (y > 280) {
        pdf.addPage();
        y = 20;
      }
      pdf.text(`${item.color.id}: ${item.color.name} - ${item.count} PCS`, 10, y);
      y += 5;
    });

    pdf.save('bead-pattern.pdf');
    setIsExportMenuOpen(false);
  };

  const handleExportImage = async () => {
    const html2canvas = (await import('html2canvas')).default;
    
    // Create a temporary container for export
    const exportContainer = document.createElement('div');
    exportContainer.style.position = 'fixed';
    exportContainer.style.left = '-9999px';
    exportContainer.style.top = '0';
    exportContainer.style.width = `${resolution.width * 30}px`;
    exportContainer.style.backgroundColor = '#ffffff';
    exportContainer.style.padding = '40px';
    exportContainer.style.color = '#000000';
    exportContainer.style.fontFamily = 'monospace';
    
    // Title
    const title = document.createElement('h1');
    title.innerText = '拼豆像素大师 - 导出图纸';
    title.style.textAlign = 'center';
    title.style.marginBottom = '20px';
    exportContainer.appendChild(title);

    // Grid
    const gridContainer = document.createElement('div');
    gridContainer.style.display = 'grid';
    gridContainer.style.gridTemplateColumns = `repeat(${resolution.width}, 1fr)`;
    gridContainer.style.border = '1px solid #ccc';
    
    grid.forEach((row) => {
      row.forEach((pixel) => {
        if (!pixel || !pixel.color) return;
        const cell = document.createElement('div');
        cell.style.width = '30px';
        cell.style.height = '30px';
        cell.style.backgroundColor = pixel.color.hex;
        cell.style.border = '0.5px solid rgba(0,0,0,0.1)';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.fontSize = '8px';
        cell.style.fontWeight = 'bold';
        
        // Contrast color for text
        const brightness = (pixel.color.r * 299 + pixel.color.g * 587 + pixel.color.b * 114) / 1000;
        cell.style.color = brightness > 128 ? '#000000' : '#ffffff';
        cell.innerText = pixel.color.id;
        
        gridContainer.appendChild(cell);
      });
    });
    exportContainer.appendChild(gridContainer);

    // Legend
    const legendContainer = document.createElement('div');
    legendContainer.style.marginTop = '30px';
    legendContainer.style.display = 'grid';
    legendContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(150px, 1fr))';
    legendContainer.style.gap = '10px';
    
    inventory.forEach(({ color, count }) => {
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '10px';
      item.style.padding = '5px';
      item.style.border = '1px solid #eee';
      
      const swatch = document.createElement('div');
      swatch.style.width = '20px';
      swatch.style.height = '20px';
      swatch.style.backgroundColor = color.hex;
      swatch.style.borderRadius = '4px';
      
      const info = document.createElement('div');
      info.style.fontSize = '10px';
      info.innerHTML = `<strong>${color.id}</strong><br/>${color.name}<br/>${count} PCS`;
      
      item.appendChild(swatch);
      item.appendChild(info);
      legendContainer.appendChild(item);
    });
    exportContainer.appendChild(legendContainer);

    document.body.appendChild(exportContainer);
    
    try {
      const canvas = await html2canvas(exportContainer, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
      });
      const link = document.createElement('a');
      link.download = 'bead-pattern.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export image failed:', err);
    } finally {
      document.body.removeChild(exportContainer);
      setIsExportMenuOpen(false);
    }
  };
  // Animation loop for flashing effect
  React.useEffect(() => {
    if (!isSliding) return;
    let frameId: number;
    const animate = () => {
      // Force re-render of canvas
      setGrid(prev => [...prev]); 
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [isSliding]);
  const toggleFlip = () => setIsFlipped(!isFlipped);
  const handleMouseDown = () => {};
  const handleMouseMove = () => {};
  const handleMouseUp = () => {};

  const clearCanvas = () => {
    const initialGrid: PixelData[][] = [];
    const white = BEAD_COLORS_221.find(c => c.id === 'H1') || BEAD_COLORS_221[0];

    for (let y = 0; y < templateSize; y++) {
      const row: PixelData[] = [];
      for (let x = 0; x < templateSize; x++) {
        row.push({ color: white, x, y });
      }
      initialGrid.push(row);
    }
    setGrid(initialGrid);
    setRawGrid([]);
    setOriginalImage(null);
    setAspectRatio(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUndo = () => {
    clearCanvas();
    setZoom(1);
    setIsFlipped(false);
    setSubjectOffset({ x: 0, y: 0 });
    setSelectedColorId(null);
    setIsGridVisible(true);
    setShowOriginal(false);
    setBeadState('placed');
    setJoystickSpeedCmPerSec(10);
    setTool('pan');
  };

  const toggleGrid = () => setIsGridVisible(!isGridVisible);

  return (
    <div className="flex h-screen bg-[#131313] text-[#e5e2e1] overflow-hidden font-sans">
      {/* Top Navigation Bar */}
      <header className="fixed top-0 w-full z-50 bg-[#131313]/60 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-8">
            <span className="text-lg font-bold tracking-tighter text-[#baf2ff]">拼豆像素大师 (Bead Pixel Pro)</span>
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
              <button 
                onClick={() => setActiveTab('project')}
                className={cn("transition-colors", activeTab === 'project' ? "text-[#00E0FF] font-bold" : "text-[#8e9192] hover:text-white")}
              >
                颜色搜索
              </button>
              <button 
                onClick={() => {
                  setActiveTab('view');
                  setSelectedColorId(null);
                }}
                className={cn("transition-colors", activeTab === 'view' ? "text-[#00E0FF] font-bold" : "text-[#8e9192] hover:text-white")}
              >
                视图
              </button>

            </nav>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3 ml-4 relative">
              <SettingsIcon className="w-5 h-5 text-[#8e9192] cursor-pointer hover:text-white" />
              <HelpCircle className="w-5 h-5 text-[#8e9192] cursor-pointer hover:text-white" />
              <div className="relative">
                <button 
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  className="flex items-center gap-2 bg-gradient-to-br from-[#baf2ff] to-[#00daf8] text-[#00363f] px-4 py-1.5 rounded-md text-sm font-bold shadow-lg shadow-[#00daf8]/20 hover:opacity-90 transition-opacity"
                >
                  <Download className="w-4 h-4" />
                  导出
                </button>
                
                <AnimatePresence>
                  {isExportMenuOpen && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-48 bg-[#1b1b1c] border border-white/10 rounded-lg shadow-2xl z-[100] overflow-hidden"
                    >
                      <button 
                        onClick={handleExportPDF}
                        className="w-full px-4 py-3 text-left text-xs font-bold text-[#8e9192] hover:bg-[#2a2a2a] hover:text-[#00daf8] transition-all flex items-center gap-3"
                      >
                        <Download className="w-4 h-4" />
                        导出为 PDF
                      </button>
                      <button 
                        onClick={handleExportImage}
                        className="w-full px-4 py-3 text-left text-xs font-bold text-[#8e9192] hover:bg-[#2a2a2a] hover:text-[#00daf8] transition-all flex items-center gap-3 border-t border-white/5"
                      >
                        <Share2 className="w-4 h-4" />
                        导出为图片
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 pt-14">
        {/* Left Sidebar - Tools */}
        <aside className="w-20 bg-[#1b1b1c]/60 backdrop-blur-xl flex flex-col items-center py-4 gap-6 border-r border-white/5">
          <div className="flex flex-col items-center gap-1 mb-2">
            <div className="w-8 h-8 rounded bg-[#353535] flex items-center justify-center">
              <Wrench className="w-4 h-4 text-[#baf2ff]" />
            </div>
            <span className="text-[8px] uppercase tracking-widest text-[#8e9192]">工具</span>
          </div>

          <label className="flex flex-col items-center gap-1 group w-full px-2 cursor-pointer">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} accept="image/*" />
            <div className="w-12 h-12 flex items-center justify-center text-[#8e9192] group-hover:bg-[#2a2a2a] group-hover:text-white rounded-md transition-all">
              <Upload className="w-6 h-6" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-[#8e9192]">上传</span>
          </label>

          <div className="w-full px-2 space-y-4">
            <div className="flex flex-col items-center gap-2">
              <Grid3X3 className="w-5 h-5 text-[#8e9192]" />
              <span className="text-[8px] uppercase tracking-widest text-[#8e9192] text-center">底板尺寸</span>
              <div className="w-full space-y-1">
                <input 
                  type="range" 
                  min="1" 
                  max="60" 
                  step="1"
                  value={(templateSize - 2) / 5} 
                  onChange={(e) => {
                    const n = parseInt(e.target.value);
                    setTemplateSize(5 * n + 2);
                  }}
                  className="w-full h-1 accent-[#00daf8] cursor-pointer"
                />
                <div className="text-[10px] font-bold text-[#00daf8] text-center">
                  {templateSize}x{templateSize}
                </div>
              </div>
            </div>
          </div>

          <button className="flex flex-col items-center gap-1 group w-full px-2">
            <div className="w-12 h-12 flex items-center justify-center bg-[#353535] text-[#00E0FF] rounded-md transition-all">
              <Pencil className="w-6 h-6" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-[#00E0FF]">绘图</span>
          </button>

          <button onClick={clearCanvas} className="flex flex-col items-center gap-1 group w-full px-2">
            <div className="w-12 h-12 flex items-center justify-center text-[#8e9192] group-hover:bg-[#2a2a2a] group-hover:text-white rounded-md transition-all">
              <Trash2 className="w-6 h-6" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-[#8e9192]">清空</span>
          </button>

          <button onClick={toggleFlip} className="flex flex-col items-center gap-1 group w-full px-2">
            <div className="w-12 h-12 flex items-center justify-center text-[#8e9192] group-hover:bg-[#2a2a2a] group-hover:text-white rounded-md transition-all">
              <FlipHorizontal className="w-6 h-6" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-[#8e9192]">翻转</span>
          </button>

          {/* Palette Selection */}
          <div className="flex flex-col items-center gap-2 w-full px-2 py-4 border-t border-white/5">
            <span className="text-[8px] uppercase tracking-widest text-[#8e9192]">色系选择</span>
            <div className="flex bg-[#2a2a2a] p-1 rounded-md w-full">
              <button 
                onClick={() => updatePalette('221')}
                className={cn(
                  "flex-1 py-1 text-[8px] font-bold rounded transition-all",
                  paletteType === '221' ? "bg-[#00daf8] text-[#00363f]" : "text-[#8e9192] hover:text-white"
                )}
              >
                221色
              </button>
              <button 
                onClick={() => updatePalette('291')}
                className={cn(
                  "flex-1 py-1 text-[8px] font-bold rounded transition-all",
                  paletteType === '291' ? "bg-[#00daf8] text-[#00363f]" : "text-[#8e9192] hover:text-white"
                )}
              >
                291色
              </button>
            </div>
          </div>

          {/* Image Size Controls */}
          <div className="flex flex-col items-center gap-4 w-full px-2 py-4 border-t border-white/5">
            <div className="flex flex-col items-center gap-1">
               <button 
                onClick={() => setIsLocked(!isLocked)}
                className={cn(
                  "w-10 h-10 flex items-center justify-center rounded-md transition-all",
                  isLocked ? "bg-[#00daf8] text-[#00363f]" : "text-[#8e9192] hover:bg-[#2a2a2a] hover:text-white"
                )}
              >
                {isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
              </button>
              <span className="text-[8px] uppercase tracking-widest text-[#8e9192]">{isLocked ? '已锁定' : '图片尺寸'}</span>
            </div>

            <div className={cn("flex flex-col gap-4 w-full items-center", isLocked && "opacity-30 pointer-events-none")}>
              <div className="flex flex-col items-center w-full gap-2">
                <input 
                  type="range" 
                  min="0.3" 
                  max="3" 
                  step="0.05"
                  value={imageScale} 
                  onChange={(e) => setImageScale(parseFloat(e.target.value))}
                  className="w-12 h-1 accent-[#00daf8] cursor-pointer"
                />
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-mono text-[#00daf8] font-bold">{Math.round(imageScale * 100)}%</span>
                  <span className="text-[8px] font-mono text-[#8e9192] uppercase">Image scale</span>
                </div>
              </div>

              {/* Filter Sliders */}
              <div className="w-full flex flex-col gap-3 pt-4 border-t border-white/5">
                <div className="flex flex-col items-center gap-1">
                  <input 
                    type="range" 
                    min="1" 
                    max="3" 
                    step="0.1"
                    value={saturation} 
                    onChange={(e) => updateFilters(parseFloat(e.target.value), contrast)}
                    className="w-12 h-1 accent-[#ff4081] cursor-pointer"
                  />
                  <span className="text-[8px] uppercase tracking-widest text-[#8e9192]">饱和度</span>
                </div>
                <div className="flex flex-col items-center gap-1 w-full">
                  <div className="flex items-center justify-between w-full px-1">
                    <span className="text-[8px] uppercase tracking-widest text-[#8e9192]">最小色块: {minSize} 豆</span>
                    <button 
                      onClick={() => setShowOriginal(!showOriginal)}
                      className={cn(
                        "p-1 rounded transition-all",
                        showOriginal ? "bg-[#00daf8] text-[#00363f]" : "text-[#8e9192] hover:text-white"
                      )}
                      title="查看原图"
                    >
                      <SaveIcon className="w-3 h-3" /> {/* Using SaveIcon as a placeholder for eye/view */}
                    </button>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="30" 
                    step="1"
                    value={minSize} 
                    onMouseDown={() => {
                      setIsSliding(true);
                      setSelectedColorId(null); // Reset isolation state
                    }}
                    onMouseUp={() => setIsSliding(false)}
                    onMouseLeave={() => setIsSliding(false)}
                    onTouchStart={() => {
                      setIsSliding(true);
                      setSelectedColorId(null);
                    }}
                    onTouchEnd={() => setIsSliding(false)}
                    onChange={(e) => setMinSize(parseInt(e.target.value))}
                    className="w-full h-1 accent-[#4caf50] cursor-pointer"
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <input 
                    type="range" 
                    min="1" 
                    max="2" 
                    step="0.05"
                    value={contrast} 
                    onChange={(e) => updateFilters(saturation, parseFloat(e.target.value))}
                    className="w-12 h-1 accent-[#ffeb3b] cursor-pointer"
                  />
                  <span className="text-[8px] uppercase tracking-widest text-[#8e9192]">对比度</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-auto w-full" />
        </aside>

        {/* Main Canvas Area */}
        <main 
          className="flex-1 bg-[#0e0e0e] relative overflow-auto flex items-center justify-center custom-scrollbar"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedColorId(null);
          }}
        >
          {/* Canvas Controls */}
          <div className="fixed top-18 left-24 z-10 flex gap-2">
            <div className="bg-[#2a2a2a]/80 backdrop-blur-md p-1 rounded-lg flex gap-1 border border-white/5">
              <button onClick={() => setZoom(z => Math.min(z + 0.1, 3))} className="p-2 hover:bg-[#353535] rounded text-white transition-colors">
                <ZoomInIcon className="w-4 h-4" />
              </button>
              <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.5))} className="p-2 hover:bg-[#353535] rounded text-white transition-colors">
                <ZoomOutIcon className="w-4 h-4" />
              </button>
              <div className="w-px bg-white/10 mx-1" />
              <button 
                onClick={() => setBeadState(s => s === 'placed' ? 'melted' : 'placed')} 
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded transition-all text-[10px] font-bold uppercase tracking-wider",
                  beadState === 'melted' ? "bg-[#00daf8] text-[#00363f]" : "bg-[#353535] text-white hover:bg-[#474747]"
                )}
              >
                {beadState === 'placed' ? '摆放模式' : '熨烫预览'}
              </button>
              <div className="w-px bg-white/10 mx-1" />
              <div className="px-3 py-1.5 bg-[#131313]/50 rounded text-[10px] font-mono text-[#00daf8] flex items-center gap-2">
                <Grid3X3 className="w-3 h-3" />
                {resolution.width} x {resolution.height} 颗
              </div>
            </div>
          </div>

          {/* The Grid */}
          <div 
            className={cn(
              "relative border border-white/5 shadow-2xl transition-all duration-500",
              isFlipped && "scale-x-[-1]"
            )}
            ref={boardRef}
            style={{ 
              transform: `scale(${zoom}) ${isFlipped ? 'scaleX(-1)' : ''}`,
              width: aspectRatio ? (aspectRatio > 1 ? '800px' : `${800 * aspectRatio}px`) : '800px',
              height: aspectRatio ? (aspectRatio > 1 ? `${800 / aspectRatio}px` : '800px') : '800px',
              backgroundColor: '#131313',
              backgroundImage: isGridVisible ? `
                linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
                linear-gradient(to right, rgba(0, 218, 248, 0.1) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(0, 218, 248, 0.1) 1px, transparent 1px)
              ` : 'none',
              backgroundSize: aspectRatio 
                ? (aspectRatio > 1 
                    ? `${800 / resolution.width}px ${800 / (aspectRatio * resolution.height)}px` 
                    : `${(800 * aspectRatio) / resolution.width}px ${800 / resolution.height}px`)
                : `${800 / resolution.width}px ${800 / resolution.height}px`,
              filter: beadState === 'melted' ? 'blur(2px) contrast(1.5)' : 'none'
            }}
          >
            {isLoading && (
              <div className="absolute inset-0 z-20 bg-[#131313]/80 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-[#00daf8] border-t-transparent rounded-full animate-spin" />
                  <p className="text-[#00daf8] font-bold tracking-widest text-xs uppercase">正在处理图像...</p>
                </div>
              </div>
            )}
            <canvas 
              ref={canvasRef}
              width={aspectRatio ? (aspectRatio > 1 ? 1600 : 1600 * aspectRatio) : 1600}
              height={aspectRatio ? (aspectRatio > 1 ? 1600 / aspectRatio : 1600) : 1600}
              onClick={handleCanvasClick}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="absolute inset-0 w-full h-full"
            />
          </div>

          {/* Isolation Indicator */}
          <AnimatePresence>
            {selectedColorId && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-6 bg-[#00daf8]/10 border border-[#00daf8]/20 text-[#00daf8] px-4 py-2 rounded-full flex items-center gap-3 backdrop-blur-md"
              >
                <Target className="w-4 h-4" />
                <span className="text-xs font-bold tracking-tight">
                  单色模式: {(paletteType === '221' ? BEAD_COLORS_221 : BEAD_COLORS_291).find(c => c.id === selectedColorId)?.name} ({selectedColorId})
                </span>
                <button 
                  onClick={() => setSelectedColorId(null)}
                  className="bg-[#00daf8] text-[#00363f] px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                >
                  退出
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Right Sidebar - Inventory */}
        <aside className="w-64 bg-[#1b1b1c]/60 backdrop-blur-xl flex flex-col p-4 border-l border-white/5">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xs font-medium text-white uppercase tracking-widest">库存</h2>
              <p className="text-[10px] text-[#8e9192]">已匹配 {inventory.length} 种颜色</p>
            </div>
            <PaletteIcon className="w-4 h-4 text-[#8e9192] cursor-pointer hover:text-white" />
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            {inventory.map(({ color, count }) => (
              <div 
                key={color.id}
                onClick={() => {
                  if (activeTab === 'project') {
                    setSelectedColorId(selectedColorId === color.id ? null : color.id);
                  }
                }}
                className={cn(
                  "flex items-center justify-between p-3 rounded transition-all group",
                  activeTab === 'project' ? "cursor-pointer" : "cursor-default",
                  selectedColorId === color.id 
                    ? "bg-[#2a2a2a] border-b-2 border-[#00daf8]" 
                    : "bg-[#202020]/40 hover:bg-[#2a2a2a]"
                )}
              >
                <div className="flex items-center gap-3">
                  <div 
                    className={cn(
                      "w-8 h-8 rounded-full border border-white/10 shadow-lg transition-all duration-300",
                      selectedColorId === color.id ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#1b1b1c]" : ""
                    )}
                    style={{ backgroundColor: color.hex }}
                  />
                  <div>
                    <p className={cn("text-xs font-bold leading-none", selectedColorId === color.id ? "text-white" : "text-[#8e9192] group-hover:text-white")}>
                      {color.name}
                    </p>
                    <p className="text-[10px] text-[#00daf8] mt-1 font-mono">{color.id}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn("text-[10px] font-bold", selectedColorId === color.id ? "text-white" : "text-[#8e9192] group-hover:text-white")}>
                    {count.toLocaleString()}
                  </p>
                  <p className="text-[8px] text-[#8e9192] uppercase">PCS</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-auto pt-4 space-y-3">
            <button className="w-full flex items-center justify-center gap-2 p-2 rounded-md bg-[#2a2a2a] text-[#e5e2e1] hover:text-[#00daf8] transition-all text-[10px] uppercase font-bold tracking-widest border border-white/5">
              <PlusCircle className="w-4 h-4" />
              添加新颜色
            </button>
          </div>
        </aside>
      </div>

      {/* Floating Undo Button */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <button 
          onClick={handleUndo}
          className="p-3 text-[#e5e2e1] hover:bg-[#2a2a2a] rounded-lg transition-colors flex flex-col items-center gap-1 bg-[#1b1b1c]/80 backdrop-blur-xl rounded-xl shadow-2xl border border-white/5"
        >
          <Undo2 className="w-5 h-5" />
          <span className="text-[8px] uppercase tracking-tighter">撤销</span>
        </button>
      </div>

      {/* Joystick: move image freely */}
      <div className="fixed bottom-6 left-28 z-50 select-none">
        <div className="text-[10px] uppercase tracking-widest text-[#8e9192] mb-2">
          移动图案 <span className="text-[#00daf8] font-mono normal-case">{joystickSpeedCmPerSec} cm/s</span>
        </div>
        <div
          ref={joystickRef}
          className="w-24 h-24 rounded-full bg-[#1b1b1c]/80 backdrop-blur-xl border border-white/10 shadow-2xl flex items-center justify-center touch-none"
          style={{ userSelect: 'none' }}
        >
          <div className="absolute w-2 h-2 rounded-full bg-white/10" />
          <div
            ref={joystickKnobRef}
            className="w-10 h-10 rounded-full bg-[#00daf8]/20 border border-[#00daf8]/30 shadow-lg"
            style={{ transform: 'translate(0px, 0px)' }}
          />
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #353535;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #474747;
        }
      `}</style>
    </div>
  );
}
