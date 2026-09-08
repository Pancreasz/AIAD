import { useState, useRef, useEffect, useCallback } from 'react'
import './ClockDrawing.css'

// Tablet physical size: 10" x 6.25", ratio is 1.6
const TABLET_WIDTH = 10.0
const TABLET_HEIGHT = 6.25
const TABLET_ASPECT_RATIO = TABLET_WIDTH / TABLET_HEIGHT

export function DrawingTest({ onFinish, instructionEn, instructionTh, testId = 'clock' }) {
  const [calibration, setCalibration] = useState(() => {
    try {
      const stored = localStorage.getItem('penTabletCalibration')
      return stored ? JSON.parse(stored) : null
    } catch (e) {
      return null
    }
  })

  // 'idle' | 'calib-tl' | 'calib-br' | 'drawing' | 'crop-tl' | 'crop-br' | 'prompt-dimensions'
  const [appState, setAppState] = useState('idle')
  const [calibPoints, setCalibPoints] = useState({ topLeft: null, bottomRight: null })
  const [calibError, setCalibError] = useState(null)

  const [strokes, setStrokes] = useState([])
  const [currentStroke, setCurrentStroke] = useState(null)
  
  const [isPortrait, setIsPortrait] = useState(true)
  const [customDimensions, setCustomDimensions] = useState({ width: TABLET_WIDTH, height: TABLET_HEIGHT })
  const [tempDim, setTempDim] = useState({ w: '', h: '' })
  const currentRatio = isPortrait ? (customDimensions.height / customDimensions.width) : (customDimensions.width / customDimensions.height)
  
  const [cropBox, setCropBox] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`${testId}CropBox`)) } 
    catch(e) { return null }
  })
  const [cropPoints, setCropPoints] = useState({ topLeft: null })

  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const isDrawing = useRef(false)
  const [canvasReady, setCanvasReady] = useState(0)

  // When testId changes, reset state and load appropriate crop box
  useEffect(() => {
    setAppState('idle')
    setStrokes([])
    try {
      const storedCrop = localStorage.getItem(`${testId}CropBox`)
      setCropBox(storedCrop ? JSON.parse(storedCrop) : null)
    } catch(e) { setCropBox(null) }
  }, [testId])

  useEffect(() => {
    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase()
      if (appState === 'idle') {
        if (key === 'c') {
          setAppState('calib-tl')
          setCalibPoints({ topLeft: null, bottomRight: null })
          setCalibError(null)
        } else if (key === 'b') {
          if (!calibration) {
            alert('Please calibrate full tablet (C) first')
            return
          }
          setAppState('crop-tl')
          setCropPoints({ topLeft: null })
        } else if (key === 's') {
          if (!calibration) {
            alert('Please calibrate first by pressing C.')
            return
          }
          setAppState('drawing')
        } else if (key === 'r') {
          setIsPortrait(p => !p)
        } else if (key === 'a') {
          setTempDim({ w: customDimensions.width.toString(), h: customDimensions.height.toString() })
          setAppState('prompt-dimensions')
        }
      } else if (appState === 'drawing') {
        if (key === 'escape') {
          setAppState('idle')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [appState, calibration, customDimensions])

  const handleCalibrationPointerDown = (e) => {
    e.preventDefault()
    const x = e.clientX
    const y = e.clientY

    if (appState === 'calib-tl') {
      setCalibPoints(p => ({ ...p, topLeft: { x, y } }))
      setAppState('calib-br')
      setCalibError(null)
    } else if (appState === 'calib-br') {
      const p1 = calibPoints.topLeft
      const p2 = { x, y }
      
      if (p2.x <= p1.x || p2.y <= p1.y) {
        setCalibError('Invalid calibration. The bottom-right point must be below and to the right of the top-left point. Please try again.')
        setCalibPoints({ topLeft: null, bottomRight: null })
        setAppState('calib-tl')
        return
      }
      
      const newCalibration = {
        topLeftX: p1.x,
        topLeftY: p1.y,
        bottomRightX: p2.x,
        bottomRightY: p2.y
      }
      setCalibration(newCalibration)
      localStorage.setItem('penTabletCalibration', JSON.stringify(newCalibration))
      setAppState('idle')
    }
  }

  const handleCropPointerDown = (e) => {
    e.preventDefault()
    const { normX, normY } = mapCoordinate(e.clientX, e.clientY)

    if (appState === 'crop-tl') {
      setCropPoints({ topLeft: { x: normX, y: normY } })
      setAppState('crop-br')
    } else if (appState === 'crop-br') {
      const p1 = cropPoints.topLeft
      const p2 = { x: normX, y: normY }
      
      const newCrop = {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        w: Math.abs(p2.x - p1.x),
        h: Math.abs(p2.y - p1.y)
      }
      setCropBox(newCrop)
      localStorage.setItem(`${testId}CropBox`, JSON.stringify(newCrop))
      setAppState('idle')
    }
  }

  // Raw to Normalized mapping
  const mapCoordinate = useCallback((rawX, rawY) => {
    if (!calibration) return { x: 0, y: 0 }
    let normX = (rawX - calibration.topLeftX) / (calibration.bottomRightX - calibration.topLeftX)
    let normY = (rawY - calibration.topLeftY) / (calibration.bottomRightY - calibration.topLeftY)
    normX = Math.max(0, Math.min(1, normX))
    normY = Math.max(0, Math.min(1, normY))
    return { normX, normY }
  }, [calibration])

  const getCanvasCoordinates = useCallback((normX, normY) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    return { x: normX * canvas.width, y: normY * canvas.height }
  }, [])

  const handlePointerDown = useCallback((e) => {
    if (appState !== 'drawing' || !calibration) return
    if (e.target.closest('button')) return

    isDrawing.current = true
    if (containerRef.current) {
      containerRef.current.setPointerCapture(e.pointerId)
    }
    
    const { normX, normY } = mapCoordinate(e.clientX, e.clientY)
    setCurrentStroke({
      startTime: Date.now(),
      points: [{ x: normX, y: normY, timestamp: Date.now(), pressure: e.pressure }]
    })
  }, [appState, calibration, mapCoordinate])

  const handlePointerMove = useCallback((e) => {
    if (!isDrawing.current || !currentStroke) return
    const { normX, normY } = mapCoordinate(e.clientX, e.clientY)
    setCurrentStroke(prev => ({
      ...prev,
      points: [...prev.points, { x: normX, y: normY, timestamp: Date.now(), pressure: e.pressure }]
    }))
  }, [currentStroke, mapCoordinate])

  const handlePointerUp = useCallback((e) => {
    if (!isDrawing.current) return
    isDrawing.current = false
    
    if (containerRef.current) {
      try { containerRef.current.releasePointerCapture(e.pointerId) } 
      catch (err) {}
    }

    if (currentStroke) {
      setStrokes(prev => [...prev, { ...currentStroke, endTime: Date.now() }])
      setCurrentStroke(null)
    }
  }, [currentStroke])

  const handleFinish = async () => {
    const canvas = canvasRef.current
    let dataUrl = null
    
    if (canvas) {
      if (cropBox) {
        // Create an offscreen canvas to render just the cropped area
        const cropCanvas = document.createElement('canvas')
        const cropW = canvas.width * cropBox.w
        const cropH = canvas.height * cropBox.h
        cropCanvas.width = cropW
        cropCanvas.height = cropH
        const ctx = cropCanvas.getContext('2d')
        
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, cropW, cropH)
        
        // Draw the main canvas onto the crop canvas, offset by the crop box coordinates
        ctx.drawImage(
          canvas,
          canvas.width * cropBox.x, canvas.height * cropBox.y, cropW, cropH,
          0, 0, cropW, cropH
        )
        dataUrl = cropCanvas.toDataURL('image/png')
      } else {
        dataUrl = canvas.toDataURL('image/png')
      }
    }

    const jsonStr = JSON.stringify({ testId, customDimensions, cropBox, strokes }, null, 2)

    if (dataUrl) {
      const timestamp = Date.now()
      
      if (window.api && window.api.saveFile) {
        try {
          await window.api.saveFile(`${testId}-drawing-${timestamp}.png`, dataUrl)
          await window.api.saveFile(`${testId}-drawing-${timestamp}.json`, jsonStr)
        } catch (e) {
          console.error("Failed to save via IPC, trying browser fallback", e)
          // Fallback
          const a = document.createElement('a')
          a.href = dataUrl
          a.download = `${testId}-drawing-${timestamp}.png`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
      } else {
        // Fallback for browser testing
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `${testId}-drawing-${timestamp}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)

        const blob = new Blob([jsonStr], { type: 'application/json' })
        const jsonUrl = URL.createObjectURL(blob)
        const aJson = document.createElement('a')
        aJson.href = jsonUrl
        aJson.download = `${testId}-drawing-${timestamp}.json`
        document.body.appendChild(aJson)
        aJson.click()
        document.body.removeChild(aJson)
        URL.revokeObjectURL(jsonUrl)
      }

      // 3. Post to the actual scoring API via main process
      // We pass both the image and the JSON data to onFinish, which triggers the scoring logic.
    }

    onFinish({ strokes, image: dataUrl, jsonStr })
  }

  useEffect(() => {
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [handlePointerDown, handlePointerMove, handlePointerUp])

  // Draw on canvas whenever strokes or currentStroke changes
  useEffect(() => {
    if (appState !== 'drawing') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#000000'

    const allStrokes = currentStroke ? [...strokes, currentStroke] : strokes
    allStrokes.forEach(stroke => {
      if (stroke.points.length === 0) return
      ctx.beginPath()
      const startPos = getCanvasCoordinates(stroke.points[0].x, stroke.points[0].y)
      ctx.moveTo(startPos.x, startPos.y)
      for (let i = 1; i < stroke.points.length; i++) {
        const pos = getCanvasCoordinates(stroke.points[i].x, stroke.points[i].y)
        ctx.lineTo(pos.x, pos.y)
      }
      ctx.stroke()
    })

    if (cropBox) {
      ctx.strokeStyle = 'rgba(0, 150, 255, 0.5)'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.strokeRect(
        cropBox.x * canvas.width, 
        cropBox.y * canvas.height, 
        cropBox.w * canvas.width, 
        cropBox.h * canvas.height
      )
      ctx.setLineDash([])
    }
  }, [strokes, currentStroke, getCanvasCoordinates, appState, cropBox, canvasReady])

  // Resize observer to maintain canvas aspect ratio
  useEffect(() => {
    if (appState !== 'drawing') return
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        const canvasWidth = width
        const canvasHeight = height
        
        const dpr = window.devicePixelRatio || 1
        canvas.width = canvasWidth * dpr
        canvas.height = canvasHeight * dpr
        
        canvas.style.width = `${canvasWidth}px`
        canvas.style.height = `${canvasHeight}px`; setCanvasReady(Date.now())
      }
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [appState, currentRatio])


  if (appState === 'prompt-dimensions') {
    return (
      <div className="clock-drawing-calibration">
        <h2>Custom Dimensions</h2>
        <p>Enter the physical dimensions of your tablet's active area.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            Width (inches): 
            <input 
              type="number" step="0.1" 
              value={tempDim.w} 
              onChange={e => setTempDim(p => ({ ...p, w: e.target.value }))} 
              style={{ padding: '5px' }}
            />
          </label>
          <label style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            Height (inches): 
            <input 
              type="number" step="0.1" 
              value={tempDim.h} 
              onChange={e => setTempDim(p => ({ ...p, h: e.target.value }))} 
              style={{ padding: '5px' }}
            />
          </label>
          <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button onClick={() => setAppState('idle')} style={{ padding: '8px 16px' }}>Cancel</button>
            <button 
              style={{ padding: '8px 16px' }}
              onClick={() => {
                const w = parseFloat(tempDim.w)
                const h = parseFloat(tempDim.h)
                if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                  setCustomDimensions({ width: w, height: h })
                  setAppState('idle')
                } else {
                  alert('Invalid dimensions entered.')
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (appState === 'calib-tl' || appState === 'calib-br') {
    return (
      <div className="clock-drawing-calibration" onPointerDown={handleCalibrationPointerDown}>
        <h2>Full Tablet Calibration</h2>
        {calibError && <p className="error">{calibError}</p>}
        {appState === 'calib-tl' ? (
          <div>
            <p>Place the pen at the <strong>TOP LEFT</strong> corner of your physical tablet and click once.</p>
            <div className="calib-target top-left-target">●</div>
          </div>
        ) : (
          <div>
            <p>Place the pen at the <strong>BOTTOM RIGHT</strong> corner of your physical tablet and click once.</p>
            <div className="calib-target bottom-right-target">●</div>
          </div>
        )}
      </div>
    )
  }

  if (appState === 'crop-tl' || appState === 'crop-br') {
    return (
      <div className="clock-drawing-calibration" onPointerDown={handleCropPointerDown}>
        <h2>{testId.toUpperCase()} Bounding Box</h2>
        {appState === 'crop-tl' ? (
          <div>
            <p>Place the pen at the <strong>TOP LEFT</strong> corner of the Test Box on the paper and click once.</p>
          </div>
        ) : (
          <div>
            <p>Place the pen at the <strong>BOTTOM RIGHT</strong> corner of the Test Box on the paper and click once.</p>
          </div>
        )}
      </div>
    )
  }


  if (appState === 'drawing') {
    return (
      <div className="fullscreen-drawing">
        <div className="floating-controls">
          <button onClick={() => setAppState('idle')}>Back (Esc)</button>
          <button onClick={() => setStrokes([])}>Clear</button>
          <button onClick={handleFinish}>Finish</button>
        </div>
        <div className="canvas-wrapper" ref={containerRef}>
          <canvas ref={canvasRef} className="clock-canvas" />
        </div>
      </div>
    )
  }

  return (
    <div className="clock-drawing-container">
      <div className="clock-drawing-header">
        <div className="clock-drawing-instructions">
          <p>{instructionEn}</p>
          <p lang="th" className="instruction-th">{instructionTh}</p>
          <div className="clock-drawing-calib-info" style={{ marginTop: '20px' }}>
            {calibration ? (
              <p>Tablet Calibration complete. Active area: 10.00" × 6.25"</p>
            ) : (
              <p>No calibration data found.</p>
            )}
            <div style={{ marginTop: '20px', fontSize: '1.2em' }}>
              <p>Press <strong>"C"</strong> on your keyboard to Calibrate the full physical tablet (Required Once).</p>
              <p>Press <strong>"B"</strong> to define the Bounding Box area (Optional crop for saving).</p>
              <p>Press <strong>"A"</strong> to set custom dimensions (Current: {customDimensions.width}" × {customDimensions.height}")</p>
              <p>Press <strong>"R"</strong> to toggle Portrait/Landscape (Current: {isPortrait ? 'Portrait' : 'Landscape'})</p>
              <p>Press <strong>"S"</strong> on your keyboard to Start drawing.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
