'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Camera } from 'lucide-react'

type Props = {
  onScan: (barcode: string) => void
  onClose: () => void
}

export default function CameraScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animRef = useRef<number | null>(null)
  const lastValueRef = useRef<string | null>(null)
  const lastTimeRef = useRef<number>(0)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'denied'>('starting')

  useEffect(() => {
    if (!('BarcodeDetector' in window)) {
      setStatus('unsupported')
      return
    }
    startCamera()
    return () => stop()
  }, [])

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setStatus('scanning')
      scan()
    } catch {
      setStatus('denied')
    }
  }

  function scan() {
    const detector = new (window as any).BarcodeDetector({
      formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'itf'],
    })

    async function loop() {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        animRef.current = requestAnimationFrame(loop)
        return
      }
      try {
        const results = await detector.detect(videoRef.current)
        if (results.length > 0) {
          const value = results[0].rawValue
          const now = Date.now()
          if (value !== lastValueRef.current || now - lastTimeRef.current > 2000) {
            lastValueRef.current = value
            lastTimeRef.current = now
            onScan(value)
          }
        }
      } catch {}
      animRef.current = requestAnimationFrame(loop)
    }

    loop()
  }

  function stop() {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function handleClose() {
    stop()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <p className="text-white font-semibold text-lg">Scan Barcode</p>
        <button onClick={handleClose} className="p-2 text-gray-300 hover:text-white touch-manipulation">
          <X size={26} />
        </button>
      </div>

      {status === 'unsupported' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-5">
          <Camera size={52} className="text-gray-500" />
          <div>
            <p className="text-white font-bold text-lg">Camera scanning not available</p>
            <p className="text-gray-400 text-sm mt-2">Requires iOS 17+, Chrome, or Edge. Use your scan gun or type the barcode manually.</p>
          </div>
          <button onClick={handleClose} className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-xl font-semibold touch-manipulation">
            Go Back
          </button>
        </div>
      )}

      {status === 'denied' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-5">
          <Camera size={52} className="text-gray-500" />
          <div>
            <p className="text-white font-bold text-lg">Camera access denied</p>
            <p className="text-gray-400 text-sm mt-2">Allow camera access in your browser settings, then try again.</p>
          </div>
          <button onClick={handleClose} className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-xl font-semibold touch-manipulation">
            Go Back
          </button>
        </div>
      )}

      {status === 'starting' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400">Starting camera...</p>
        </div>
      )}

      {status === 'scanning' && (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
          {/* Viewfinder overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="relative w-72 h-44">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
              {/* Scan line animation */}
              <div className="absolute inset-x-2 h-0.5 bg-white/60 animate-bounce top-1/2" />
            </div>
            <p className="text-white/80 text-sm mt-6 font-medium">Point camera at barcode</p>
          </div>
        </div>
      )}

      {/* Show video ref even in starting state so it's ready */}
      {status === 'starting' && (
        <video ref={videoRef} className="hidden" playsInline muted />
      )}
    </div>
  )
}
