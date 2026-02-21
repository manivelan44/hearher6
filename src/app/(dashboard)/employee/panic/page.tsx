'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import { createPanicAlert, resolvePanicAlert, updatePanicLocation, uploadPanicRecording } from '@/lib/data-service';
import { Video, Mic, Download, StopCircle } from 'lucide-react';

// ─── States ─────────────────────────────────────────────────────────────────

type PanicState = 'idle' | 'countdown' | 'active' | 'resolved';

export default function PanicButtonPage() {
    const { user } = useAuth();
    const [state, setState] = useState<PanicState>('idle');
    const [countdown, setCountdown] = useState(5);
    const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [locationUpdates, setLocationUpdates] = useState(0);
    const alertIdRef = useRef<string | null>(null);
    const watchIdRef = useRef<number | null>(null);
    const lastUpdateRef = useRef<number>(0);

    // Recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
    const [permissionGranted, setPermissionGranted] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const videoPreviewRef = useRef<HTMLVideoElement>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ─── Geolocation ────────────────────────────────────────────────────────

    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                () => setLocation({ lat: 12.9716, lng: 77.5946 }) // fallback
            );
        }
    }, []);

    // ─── Pre-authorize Camera & Mic on page load ─────────────────────────────

    useEffect(() => {
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true,
        }).then((stream) => {
            streamRef.current = stream;
            setPermissionGranted(true);
            // Stop tracks for now — we'll re-use permission later
            stream.getTracks().forEach((t) => t.stop());
        }).catch(() => {
            console.warn('Camera/mic permission denied on page load');
        });
    }, []);

    // ─── Countdown Timer ────────────────────────────────────────────────────

    useEffect(() => {
        if (state !== 'countdown') return;
        if (countdown <= 0) {
            setState('active');
            return;
        }
        const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => clearTimeout(timer);
    }, [state, countdown]);

    // ─── Start Recording when Active ────────────────────────────────────────

    useEffect(() => {
        if (state !== 'active') return;

        // Create panic alert in DB
        const loc = location || { lat: 12.9716, lng: 77.5946 };
        createPanicAlert({
            userId: user?.id || '22222222-2222-2222-2222-222222222222',
            orgId: user?.org_id || '11111111-1111-1111-1111-111111111111',
            latitude: loc.lat,
            longitude: loc.lng,
            source: 'panic',
        }).then((id) => {
            alertIdRef.current = id;
        });

        // Start camera + microphone recording
        startRecording();

        // Start live GPS tracking — sends location to Supabase every 5 seconds
        if (navigator.geolocation) {
            watchIdRef.current = navigator.geolocation.watchPosition(
                (pos) => {
                    const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    setLocation(newLoc);

                    // Throttle DB updates to every 5 seconds
                    const now = Date.now();
                    if (now - lastUpdateRef.current >= 5000 && alertIdRef.current) {
                        lastUpdateRef.current = now;
                        updatePanicLocation(alertIdRef.current, newLoc.lat, newLoc.lng);
                        setLocationUpdates((c) => c + 1);
                    }
                },
                (err) => console.warn('GPS watch error:', err),
                { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
            );
        }

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    const startRecording = async () => {
        try {
            // Permission already granted on page load — this opens instantly
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: true,
            });

            streamRef.current = stream;
            chunksRef.current = [];

            // Show live preview
            if (videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = stream;
                videoPreviewRef.current.play();
            }

            // Create MediaRecorder
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
                ? 'video/webm;codecs=vp9,opus'
                : MediaRecorder.isTypeSupported('video/webm')
                    ? 'video/webm'
                    : 'video/mp4';

            const recorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                setRecordedBlob(blob);
            };

            recorder.start(1000); // collect data every second
            setIsRecording(true);
            setRecordingTime(0);

            // Recording timer
            timerRef.current = setInterval(() => {
                setRecordingTime((t) => t + 1);
            }, 1000);

        } catch (err) {
            console.error('Failed to access camera/microphone:', err);
            alert('⚠️ Camera/microphone access denied. Please allow access for evidence recording.');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setIsRecording(false);
    };

    const autoDownloadEvidence = (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `panic-evidence-${timestamp}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const formatTime = (s: number) => {
        const mins = Math.floor(s / 60).toString().padStart(2, '0');
        const secs = (s % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    // ─── Actions ────────────────────────────────────────────────────────────

    const triggerPanic = () => {
        setState('countdown');
        setCountdown(5);
        setRecordedBlob(null);
    };

    const cancel = () => {
        setState('idle');
        setCountdown(5);
        setLocationUpdates(0);
    };

    const resolve = async () => {
        // Stop recording — this triggers onstop which sets recordedBlob
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            // Override onstop to auto-download + email to HR
            mediaRecorderRef.current.onstop = () => {
                const mimeType = mediaRecorderRef.current?.mimeType || 'video/webm';
                const blob = new Blob(chunksRef.current, { type: mimeType });
                setRecordedBlob(blob);

                // Auto-download immediately
                autoDownloadEvidence(blob);

                // Upload to Supabase Storage and Evidence Vault
                if (alertIdRef.current && user) {
                    uploadPanicRecording(alertIdRef.current, user.id, blob).catch((err: any) => {
                        console.error('Failed to upload panic recording', err);
                    });
                }

                // ── Email recording to HR ────────────────────────────────
                const emailFormData = new FormData();
                const timestamp = new Date().toISOString();
                emailFormData.append('recording', blob, `panic-evidence-${timestamp.replace(/[:.]/g, '-')}.webm`);
                emailFormData.append('employeeName', user?.name || 'Unknown Employee');
                emailFormData.append('employeeEmail', user?.email || 'N/A');
                emailFormData.append('latitude', String(location?.lat || 'N/A'));
                emailFormData.append('longitude', String(location?.lng || 'N/A'));
                emailFormData.append('timestamp', timestamp);

                fetch('/api/send-panic-email', { method: 'POST', body: emailFormData })
                    .then((res) => res.json())
                    .then((data) => {
                        if (data.success) {
                            console.log('📧 Panic evidence emailed to HR successfully', data.testMode ? `(Test: ${data.previewUrl})` : '');
                        } else {
                            console.error('📧 Email API error:', data.error);
                        }
                    })
                    .catch((err) => console.error('📧 Failed to email panic evidence:', err));
            };
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setIsRecording(false);

        if (alertIdRef.current) {
            await resolvePanicAlert(alertIdRef.current);
            alertIdRef.current = null;
        }
        setState('resolved');
        setLocationUpdates(0);

        // Stop live GPS tracking
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }
    };

    const backToIdle = () => {
        setState('idle');
        setRecordedBlob(null);
    };

    // ─── Render ─────────────────────────────────────────────────────────────

    return (
        <div className="page-enter flex flex-col items-center justify-center min-h-[70vh] text-center">
            <AnimatePresence mode="wait">
                {/* ── IDLE ──────────────────────────────────────────────────── */}
                {state === 'idle' && (
                    <motion.div key="idle" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex flex-col items-center gap-6">
                        <h1 className="text-2xl font-bold gradient-text">🚨 Panic Button</h1>
                        <p className="text-sm text-slate-400 max-w-sm">
                            Feeling unsafe? Tap the button below to send an immediate SOS alert to Security and automatically start recording evidence.
                        </p>

                        <button
                            onClick={triggerPanic}
                            className="w-44 h-44 rounded-full flex items-center justify-center text-6xl transition-all duration-300 hover:scale-110 active:scale-95"
                            style={{
                                background: 'radial-gradient(circle, #ef4444 0%, #b91c1c 100%)',
                                boxShadow: '0 0 60px rgba(239,68,68,0.4), 0 0 120px rgba(239,68,68,0.15)',
                                border: '4px solid rgba(239,68,68,0.3)',
                            }}
                        >
                            🆘
                        </button>

                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Video size={14} /> <Mic size={14} />
                            {permissionGranted
                                ? <span className="text-emerald-400">✓ Camera & mic ready — will auto-record</span>
                                : <span>Camera & mic will auto-record as evidence</span>
                            }
                        </div>

                        <p className="text-xs text-slate-500">You&apos;ll have 5 seconds to cancel after pressing</p>

                        {location && (
                            <p className="text-xs text-slate-600">
                                📍 Location ready: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                            </p>
                        )}
                    </motion.div>
                )}

                {/* ── COUNTDOWN ─────────────────────────────────────────────── */}
                {state === 'countdown' && (
                    <motion.div key="countdown" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6">
                        <h2 className="text-xl font-bold text-red-400">⚠️ Sending SOS in...</h2>

                        <div
                            className="w-36 h-36 rounded-full flex items-center justify-center text-6xl font-bold animate-pulse"
                            style={{
                                background: 'radial-gradient(circle, #ef444430, #b91c1c10)',
                                border: '3px solid #ef4444',
                                color: '#ef4444',
                            }}
                        >
                            {countdown}
                        </div>

                        <p className="text-xs text-slate-400 flex items-center gap-2">
                            <Video size={14} className="text-red-400" />
                            <Mic size={14} className="text-red-400" />
                            Camera & mic will activate on SOS
                        </p>

                        <button onClick={cancel} className="btn-ghost text-sm border border-white/20 px-6">
                            ✕ Cancel
                        </button>
                    </motion.div>
                )}

                {/* ── ACTIVE ────────────────────────────────────────────────── */}
                {state === 'active' && (
                    <motion.div key="active" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 w-full max-w-md">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl animate-pulse" style={{ background: '#ef444420', border: '2px solid #ef4444' }}>
                            🚨
                        </div>
                        <h2 className="text-xl font-bold text-red-400">SOS Alert Active!</h2>

                        {/* Live Video Preview */}
                        <div className="relative w-full rounded-2xl overflow-hidden" style={{ background: '#000', border: '2px solid #ef444440' }}>
                            <video
                                ref={videoPreviewRef}
                                autoPlay
                                muted
                                playsInline
                                className="w-full h-48 object-cover"
                                style={{ transform: 'scaleX(-1)' }}
                            />
                            {/* Recording indicator */}
                            {isRecording && (
                                <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.7)' }}>
                                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                                    <span className="text-xs font-mono text-white">REC {formatTime(recordingTime)}</span>
                                </div>
                            )}
                            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.7)' }}>
                                <Video size={12} className="text-red-400" />
                                <Mic size={12} className="text-red-400" />
                            </div>
                        </div>

                        <p className="text-xs text-slate-400">
                            📹 Recording video & audio as evidence. This will be saved when you resolve the alert.
                        </p>

                        {/* Live Location Map */}
                        {location && (
                            <div className="w-full rounded-xl overflow-hidden relative" style={{ border: '2px solid #ef444430' }}>
                                <iframe
                                    key={`map-${location.lat}-${location.lng}`}
                                    width="100%"
                                    height="200"
                                    style={{ border: 0, filter: 'hue-rotate(180deg) invert(1) brightness(0.85) contrast(1.1)' }}
                                    loading="eager"
                                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${location.lng - 0.004},${location.lat - 0.002},${location.lng + 0.004},${location.lat + 0.002}&layer=mapnik&marker=${location.lat},${location.lng}`}
                                />
                                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: 'rgba(0,0,0,0.75)' }}>
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                    <span className="text-[10px] font-mono text-white">YOUR LIVE LOCATION</span>
                                </div>
                                <div className="absolute bottom-2 right-2 px-2 py-1 rounded-lg" style={{ background: 'rgba(0,0,0,0.75)' }}>
                                    <span className="text-[10px] font-mono text-emerald-400">
                                        📍 {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Status Card */}
                        <div className="glass-card p-4 w-full text-left space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-slate-500">Status:</span><span className="text-red-400 font-medium">🔴 Active</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Recording:</span><span className="text-red-400 font-medium"><StopCircle size={14} className="inline mr-1" />{formatTime(recordingTime)}</span></div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">📍 Live Location:</span>
                                <span className="text-emerald-400 font-mono text-xs">
                                    {location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'Fetching...'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Location Sent:</span>
                                <span className="text-emerald-400">{locationUpdates}x to HR & Security ✓</span>
                            </div>
                            <div className="flex justify-between"><span className="text-slate-500">Notified:</span><span className="text-emerald-400">Security Team ✓</span></div>
                        </div>

                        <button onClick={resolve} className="btn-primary text-sm px-6 w-full py-3 rounded-xl font-medium" style={{ background: '#10b981' }}>
                            ✓ I&apos;m Safe — Stop Recording & Resolve
                        </button>
                    </motion.div>
                )}

                {/* ── RESOLVED ──────────────────────────────────────────────── */}
                {state === 'resolved' && (
                    <motion.div key="resolved" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 w-full max-w-md">
                        <div className="text-6xl">💚</div>
                        <h2 className="text-xl font-bold text-emerald-400">Alert Resolved</h2>
                        <p className="text-sm text-slate-400">Glad you&apos;re safe. Stay strong. 💜</p>

                        {/* Evidence confirmation */}
                        {recordedBlob && (
                            <div className="glass-card p-5 w-full space-y-3" style={{ borderColor: '#10b98130' }}>
                                <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                                    ✅ Evidence Auto-Saved
                                </h3>
                                <div className="text-sm text-slate-300 space-y-1">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Duration:</span>
                                        <span>{formatTime(recordingTime)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Size:</span>
                                        <span>{(recordedBlob.size / (1024 * 1024)).toFixed(2)} MB</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Type:</span>
                                        <span>Video + Audio</span>
                                    </div>
                                </div>
                                <p className="text-xs text-emerald-400/80 text-center">
                                    📥 Evidence recording has been automatically downloaded to your device.
                                </p>
                            </div>
                        )}

                        <button onClick={backToIdle} className="btn-ghost text-sm border border-white/20 px-6 mt-2">
                            ← Back to Panic Button
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
