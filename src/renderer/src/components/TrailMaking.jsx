import { useState, useRef, useEffect, useCallback } from 'react'
import './TrailMaking.css'

const TABLET_WIDTH = 10.0
const TABLET_HEIGHT = 6.25

const TARGETS = ['1', 'A', '2', 'B', '3', 'C', '4', 'D', '5', 'E']
const HIT_RADIUS = 0.04 // 4% of screen width/height as hit radius

function doSegmentsIntersect(p1, p2, p3, p4) {
  const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x)
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
}

function getIntersectionPoint(p1, p2, p3, p4) {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
  if (denom === 0) return null
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom
  return {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y)
  }
}

function detectLineCrossings(strokes, targets) {
  const segments = []
  strokes.forEach(stroke => {
    for (let i = 0; i < stroke.points.length - 1; i++) {
      segments.push({
        p1: stroke.points[i],
        p2: stroke.points[i + 1],
        strokeId: stroke.startTime
      })
    }
  })

  let crossings = 0
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 2; j < segments.length; j++) {
      // If it's the exact same stroke, ignore intersections that happen very close to each other in time.
      // The pointer fires at ~60Hz. If the line intersects itself within 40 points (< 0.7 seconds),
      // it's likely a hesitation loop or tremor, NOT a clinical "line crossing error" across the page.
      if (segments[i].strokeId === segments[j].strokeId && Math.abs(i - j) < 40) continue
      
      // Basic bounding box check for performance
      const s1 = segments[i], s2 = segments[j]
      const minX1 = Math.min(s1.p1.x, s1.p2.x), maxX1 = Math.max(s1.p1.x, s1.p2.x)
      const minX2 = Math.min(s2.p1.x, s2.p2.x), maxX2 = Math.max(s2.p1.x, s2.p2.x)
      if (maxX1 < minX2 || minX1 > maxX2) continue

      const minY1 = Math.min(s1.p1.y, s1.p2.y), maxY1 = Math.max(s1.p1.y, s1.p2.y)
      const minY2 = Math.min(s2.p1.y, s2.p2.y), maxY2 = Math.max(s2.p1.y, s2.p2.y)
      if (maxY1 < minY2 || minY1 > maxY2) continue

      if (doSegmentsIntersect(s1.p1, s1.p2, s2.p1, s2.p2)) {
        const pt = getIntersectionPoint(s1.p1, s1.p2, s2.p1, s2.p2)
        if (pt) {
          const inTarget = targets.some(t => {
            const dx = t.x - pt.x
            const dy = t.y - pt.y
            return Math.sqrt(dx*dx + dy*dy) < HIT_RADIUS
          })
          if (!inTarget) {
            crossings++
          }
        } else {
          crossings++
        }
      }
    }
  }
  return crossings
}

export function TrailMaking({ onFinish, instructionEn, instructionTh }) {
  const [calibration, setCalibration] = useState(() => {
    try {
      const stored = localStorage.getItem('penTabletCalibration')
      return stored ? JSON.parse(stored) : null
    } catch (e) {
      return null
    }
  })

  // 'idle' | 'registering' | 'drawing' | 'calib-tl' | 'calib-br'
  const [appState, setAppState] = useState('idle')
  const [calibPoints, setCalibPoints] = useState({ topLeft: null, bottomRight: null })
  const [calibError, setCalibError] = useState(null)

  const [registeredTargets, setRegisteredTargets] = useState(() => {
    try {
      const stored = localStorage.getItem('penTabletTrailTargets')
      return stored ? JSON.parse(stored) : []
    } catch (e) {
      return []
    }
  })
  const [strokes, setStrokes] = useState([])
  const [currentStroke, setCurrentStroke] = useState(null)
  
  const [isPortrait, setIsPortrait] = useState(true)
  const currentRatio = isPortrait ? (TABLET_HEIGHT / TABLET_WIDTH) : (TABLET_WIDTH / TABLET_HEIGHT)
  
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const isDrawing = useRef(false)
  const [canvasReady, setCanvasReady] = useState(0)

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

  useEffect(() => {
    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase()
      if (appState === 'idle') {
        if (key === 'c') {
          setAppState('calib-tl')
          setCalibPoints({ topLeft: null, bottomRight: null })
          setCalibError(null)
        } else if (key === 'r') { // Registration mode
          if (!calibration) {
            alert('No calibration found! Please calibrate first.')
            return
          }
          setAppState('registering')
          setRegisteredTargets([])
          setStrokes([])
        } else if (key === 's') { // Start drawing mode directly
          if (registeredTargets.length !== TARGETS.length) {
            alert('Please complete registration (Press R) first.')
            return
          }
          setAppState('drawing')
        } else if (key === 'p') {
          setIsPortrait(p => !p)
        }
      } else if (appState === 'drawing' || appState === 'registering') {
        if (key === 'escape') {
          setAppState('idle')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [appState, calibration, registeredTargets.length])

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
    if (e.target.closest('button')) return

    if (appState === 'registering') {
      const { normX, normY } = mapCoordinate(e.clientX, e.clientY)
      setRegisteredTargets(prev => {
        const next = [...prev, { label: TARGETS[prev.length], x: normX, y: normY }]
        if (next.length === TARGETS.length) {
          setAppState('idle') // Finished registering
          localStorage.setItem('penTabletTrailTargets', JSON.stringify(next))
        }
        return next
      })
      return
    }

    if (appState === 'drawing') {
      isDrawing.current = true
      if (containerRef.current) {
        containerRef.current.setPointerCapture(e.pointerId)
      }
      
      const { normX, normY } = mapCoordinate(e.clientX, e.clientY)
      setCurrentStroke({
        startTime: Date.now(),
        points: [{ x: normX, y: normY, timestamp: Date.now(), pressure: e.pressure }]
      })
    }
  }, [appState, mapCoordinate])

  const handlePointerMove = useCallback((e) => {
    if (appState !== 'drawing' || !isDrawing.current || !currentStroke) return
    const { normX, normY } = mapCoordinate(e.clientX, e.clientY)
    setCurrentStroke(prev => ({
      ...prev,
      points: [...prev.points, { x: normX, y: normY, timestamp: Date.now(), pressure: e.pressure }]
    }))
  }, [appState, currentStroke, mapCoordinate])

  const handlePointerUp = useCallback((e) => {
    if (appState !== 'drawing' || !isDrawing.current) return
    isDrawing.current = false
    
    if (containerRef.current) {
      try { containerRef.current.releasePointerCapture(e.pointerId) } 
      catch (err) {}
    }

    if (currentStroke) {
      setStrokes(prev => [...prev, { ...currentStroke, endTime: Date.now() }])
      setCurrentStroke(null)
    }
  }, [appState, currentStroke])

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

  // Drawing render loop
  useEffect(() => {
    if (appState !== 'drawing' && appState !== 'registering') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Draw targets
    registeredTargets.forEach(target => {
      const pos = getCanvasCoordinates(target.x, target.y)
      
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, Math.min(canvas.width, canvas.height) * HIT_RADIUS, 0, 2 * Math.PI)
      ctx.fillStyle = appState === 'registering' ? '#e0f7fa' : '#f0f0f0'
      ctx.fill()
      ctx.strokeStyle = '#00acc1'
      ctx.lineWidth = 2
      ctx.stroke()
      
      ctx.fillStyle = '#000'
      ctx.font = '20px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(target.label, pos.x, pos.y)
    })

    // Draw strokes
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#333333'

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
  }, [strokes, currentStroke, registeredTargets, getCanvasCoordinates, appState, canvasReady])

  // Canvas Resize Logic
  useEffect(() => {
    if (appState === 'idle') return
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        const containerRatio = width / height
        
        let canvasWidth, canvasHeight
        if (containerRatio > currentRatio) {
          canvasHeight = height
          canvasWidth = height * currentRatio
        } else {
          canvasWidth = width
          canvasHeight = width / currentRatio
        }
        
        const dpr = window.devicePixelRatio || 1
        canvas.width = canvasWidth * dpr
        canvas.height = canvasHeight * dpr
        canvas.style.width = `${canvasWidth}px`
        canvas.style.height = `${canvasHeight}px`
        
        setCanvasReady(Date.now())
      }
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [appState, currentRatio])

  const analyzeDrawing = () => {
    /* 
    // TOPOLOGICAL / EDGE-BASED GRADING (Allows backward drawing)
    const requiredEdges = new Set()
    for (let i = 0; i < TARGETS.length - 1; i++) {
      requiredEdges.add(`${i}-${i + 1}`)
    }

    const drawnEdges = new Set()
    const hitSequence = []

    for (const stroke of strokes) {
      const strokeHits = []
      let lastHitIndex = -1

      for (const p of stroke.points) {
        for (let i = 0; i < registeredTargets.length; i++) {
          const t = registeredTargets[i]
          const dx = p.x - t.x
          const dy = p.y - t.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < HIT_RADIUS) {
            if (lastHitIndex !== i) {
              strokeHits.push(i)
              hitSequence.push(TARGETS[i])
              lastHitIndex = i
            }
          }
        }
      }

      for (let i = 0; i < strokeHits.length - 1; i++) {
        const a = strokeHits[i]
        const b = strokeHits[i + 1]
        const edge = Math.min(a, b) + '-' + Math.max(a, b)
        drawnEdges.add(edge)
      }
    }

    let sequenceErrors = 0
    let validEdgesCount = 0

    drawnEdges.forEach(edge => {
      if (requiredEdges.has(edge)) {
        validEdgesCount++
      } else {
        sequenceErrors++
      }
    })

    const completed = validEdgesCount === requiredEdges.size
    */

    // STRICT CHRONOLOGICAL GRADING (Penalizes backward drawing)
    let expectedIndex = 0
    let sequenceErrors = 0
    let hitTargets = []
    let lastHitIndex = -1
    
    for (const stroke of strokes) {
      for (const p of stroke.points) {
        for (let i = 0; i < registeredTargets.length; i++) {
          const t = registeredTargets[i]
          const dx = p.x - t.x
          const dy = p.y - t.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          
          if (dist < HIT_RADIUS) {
            if (lastHitIndex !== i) {
              hitTargets.push(i)
              lastHitIndex = i
            }
          }
        }
      }
    }
    
    for (const hit of hitTargets) {
      if (hit === expectedIndex) {
        expectedIndex++
      } else {
        sequenceErrors++
      }
    }
    
    const completed = expectedIndex === TARGETS.length

    const lineCrossings = detectLineCrossings(strokes, registeredTargets)
    
    return {
      hitSequence: hitTargets.map(i => TARGETS[i]),
      completed,
      sequenceErrors,
      lineCrossings
    }
  }

  const handleFinish = async () => {
    const analysis = analyzeDrawing()
    const canvas = canvasRef.current
    const dataUrl = canvas ? canvas.toDataURL('image/png') : null

    if (dataUrl) {
      const timestamp = Date.now()
      const jsonStr = JSON.stringify({ analysis, strokes }, null, 2)

      if (window.api && window.api.saveFile) {
        try {
          await window.api.saveFile(`trail-making-${timestamp}.png`, dataUrl)
          await window.api.saveFile(`trail-making-${timestamp}.json`, jsonStr)
        } catch (e) {
          console.error("Failed to save via IPC", e)
        }
      } else {
        // Save locally as PNG fallback
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `trail-making-${timestamp}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)

        // Save stroke data as JSON fallback
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const jsonUrl = URL.createObjectURL(blob)
        const aJson = document.createElement('a')
        aJson.href = jsonUrl
        aJson.download = `trail-making-${timestamp}.json`
        document.body.appendChild(aJson)
        aJson.click()
        document.body.removeChild(aJson)
        URL.revokeObjectURL(jsonUrl)
      }
    }

    
    // The analysis is passed directly to the frontend scoring system!
    onFinish({ strokes, analysis, image: dataUrl })
  }


  if (appState === 'calib-tl' || appState === 'calib-br') {
    return (
      <div className="clock-drawing-calibration" onPointerDown={handleCalibrationPointerDown}>
        <h2>Pen Tablet Calibration</h2>
        {calibError && <p className="error">{calibError}</p>}
        {appState === 'calib-tl' ? (
          <div>
            <p>Place the pen at the <strong>TOP LEFT</strong> corner of your tablet's active area and click once.</p>
            <div className="calib-target top-left-target">●</div>
          </div>
        ) : (
          <div>
            <p>Place the pen at the <strong>BOTTOM RIGHT</strong> corner of your tablet's active area and click once.</p>
            <div className="calib-target bottom-right-target">●</div>
          </div>
        )}
      </div>
    )
  }

  if (appState === 'registering') {
    return (
      <div className="fullscreen-drawing">
        <div className="floating-controls" style={{ background: 'rgba(255,255,255,0.9)', padding: '10px', borderRadius: '8px' }}>
          <h3>Registration Mode</h3>
          <p>Click precisely on physical paper target: <strong>{TARGETS[registeredTargets.length]}</strong></p>
          <button onClick={() => setAppState('idle')}>Cancel (Esc)</button>
        </div>
        <div className="canvas-wrapper" ref={containerRef}>
          <canvas ref={canvasRef} className="clock-canvas" />
        </div>
      </div>
    )
  }

  if (appState === 'drawing') {
    return (
      <div className="fullscreen-drawing">
        <div className="floating-controls">
          <button onClick={() => setAppState('idle')}>Back (Esc)</button>
          <button onClick={() => setStrokes([])}>Clear Drawing</button>
          <button onClick={handleFinish}>Finish & Score</button>
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
          
          <div style={{ marginTop: '20px', fontSize: '1.2em' }}>
            <p>Press <strong>"C"</strong> on your keyboard to Calibrate the tablet.</p>
            <p><strong>Step 1:</strong> Press <strong>"R"</strong> to register NEW targets (Optional if already saved).</p>
            <p><strong>Step 2:</strong> Press <strong>"S"</strong> to let patient Start drawing.</p>
            <p>Press <strong>"P"</strong> to toggle Portrait/Landscape (Current: {isPortrait ? 'Portrait' : 'Landscape'})</p>
          </div>
          
          <div style={{ marginTop: '20px', color: '#666' }}>
            {registeredTargets.length === TARGETS.length 
              ? `✅ All ${TARGETS.length} Targets Ready (Saved from previous session)` 
              : `Targets Registered: ${registeredTargets.length} / ${TARGETS.length} (Requires Registration)`
            }
          </div>
        </div>
      </div>
    </div>
  )
}

