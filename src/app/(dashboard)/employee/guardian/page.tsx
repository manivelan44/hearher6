'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Phone, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createGuardianSession, updateGuardianSession, createPanicAlert } from '@/lib/data-service';

// ─── Types ──────────────────────────────────────────────────────────────────

type GuardianState = 'setup' | 'active' | 'checkin' | 'expired' | 'safe';

interface Contact {
    name: string;
    phone: string;
}

export default function GuardianModePage() {
    const { user } = useAuth();
    const [state, setState] = useState<GuardianState>('setup');
    const [duration, setDuration] = useState(30);
    const [contacts, setContacts] = useState<Contact[]>([
        { name: 'Amma', phone: '+91 98765 43210' },
    ]);
    const [timeLeft, setTimeLeft] = useState(0);
    const [contactName, setContactName] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const sessionIdRef = useRef<string | null>(null);

    // ─── Timer ──────────────────────────────────────────────────────────────

    useEffect(() => {
        if (state !== 'active' || timeLeft <= 0) return;
        const timer = setInterval(() => {
            setTimeLeft((t) => {
                if (t <= 1) {
                    setState('checkin');
                    return 0;
                }
                return t - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [state, timeLeft]);

    // ─── Auto-expire if check-in missed ─────────────────────────────────────

    useEffect(() => {
        if (state !== 'checkin') return;
        const expireTimer = setTimeout(() => setState('expired'), 30000); // 30s to check in
        return () => clearTimeout(expireTimer);
    }, [state]);

    const startSession = async () => {
        if (contacts.length === 0) return;
        setTimeLeft(duration * 60);
        setState('active');
        const id = await createGuardianSession({
            userId: user?.id || 'demo-emp-001',
            orgId: user?.org_id || '11111111-1111-1111-1111-111111111111',
            durationMinutes: duration,
            trustedContacts: contacts.map((c) => ({ name: c.name, phone: c.phone, email: '' })),
        });
        sessionIdRef.current = id;
    };

    const checkIn = async () => {
        setTimeLeft(duration * 60);
        setState('active');
        if (sessionIdRef.current) {
            const next = new Date(Date.now() + duration * 60 * 1000).toISOString();
            await updateGuardianSession(sessionIdRef.current, { status: 'checkedin', next_checkin: next });
        }
    };

    const endSession = async () => {
        if (sessionIdRef.current) {
            await updateGuardianSession(sessionIdRef.current, { status: 'checkedin', ended_at: new Date().toISOString() });
            sessionIdRef.current = null;
        }
        setState('safe');
        setTimeout(() => setState('setup'), 3000);
    };

    // Auto-escalate: create panic alert when check-in is missed
    useEffect(() => {
        if (state !== 'expired') return;
        createPanicAlert({
            userId: user?.id || 'demo-emp-001',
            orgId: user?.org_id || '11111111-1111-1111-1111-111111111111',
            latitude: 12.9716,
            longitude: 77.5946,
            source: 'guardian',
            message: 'Guardian mode check-in missed — auto-escalated',
        });
        if (sessionIdRef.current) {
            updateGuardianSession(sessionIdRef.current, { status: 'escalated' });
        }
    }, [state, user]);

    const addContact = () => {
        if (contactName && contactPhone) {
            setContacts((prev) => [...prev, { name: contactName, phone: contactPhone }]);
            setContactName('');
            setContactPhone('');
        }
    };

    const removeContact = (i: number) => setContacts((prev) => prev.filter((_, idx) => idx !== i));

    const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

    const inputCls = 'bg-[#0d0a1a] border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-[#a855f7] outline-none transition-all';

    // ─── Render ─────────────────────────────────────────────────────────────

    return (
        <div className="page-enter max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#a855f715' }}>
                    <Shield size={20} className="text-[#a855f7]" />
                </div>
                <div>
                    <h1 className="text-xl font-bold">Guardian Mode</h1>
                    <p className="text-xs text-slate-400">Walking alone? We&apos;ll watch over you.</p>
                </div>
            </div>

            <AnimatePresence mode="wait">
                {/* ── SETUP ─────────────────────────────────────────────────── */}
                {state === 'setup' && (
                    <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                        {/* Duration */}
                        <div className="glass-card">
                            <label className="text-sm font-medium text-slate-300 block mb-3">
                                <Clock size={14} className="inline mr-1" /> How long will you be traveling?
                            </label>
                            <div className="flex gap-3">
                                {[15, 30, 45, 60].map((m) => (
                                    <button
                                        key={m}
                                        onClick={() => setDuration(m)}
                                        className="flex-1 py-3 rounded-xl text-sm font-medium transition-all"
                                        style={{
                                            background: duration === m ? '#a855f718' : 'rgba(255,255,255,0.04)',
                                            color: duration === m ? '#a855f7' : '#8b82a8',
                                            border: `1px solid ${duration === m ? '#a855f730' : 'rgba(255,255,255,0.08)'}`,
                                        }}
                                    >
                                        {m} min
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Trusted Contacts */}
                        <div className="glass-card">
                            <label className="text-sm font-medium text-slate-300 block mb-3">
                                <Phone size={14} className="inline mr-1" /> Trusted Contacts
                            </label>
                            <div className="space-y-2 mb-4">
                                {contacts.map((c, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                                        <div>
                                            <p className="text-sm font-medium">{c.name}</p>
                                            <p className="text-xs text-slate-500">{c.phone}</p>
                                        </div>
                                        <button onClick={() => removeContact(i)} className="text-red-400 text-xs hover:text-red-300">✕</button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input className={`${inputCls} flex-1`} placeholder="Name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                                <input className={`${inputCls} flex-1`} placeholder="Phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                                <button onClick={addContact} className="btn-ghost text-sm px-3">+ Add</button>
                            </div>
                        </div>

                        {/* Start */}
                        <button
                            onClick={startSession}
                            disabled={contacts.length === 0}
                            className="w-full py-4 rounded-2xl text-lg font-semibold transition-all disabled:opacity-40"
                            style={{ background: 'linear-gradient(135deg, #a855f7, #e855a0)', color: '#fff' }}
                        >
                            🛡️ Start Guardian Mode
                        </button>
                    </motion.div>
                )}

                {/* ── ACTIVE ────────────────────────────────────────────────── */}
                {state === 'active' && (
                    <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6 py-8">
                        <div className="text-4xl animate-pulse">🛡️</div>
                        <h2 className="text-lg font-bold text-[#a855f7]">Guardian Mode Active</h2>

                        <div
                            className="w-40 h-40 rounded-full flex items-center justify-center text-3xl font-mono font-bold"
                            style={{ background: '#a855f710', border: '3px solid #a855f740', color: '#c084fc' }}
                        >
                            {formatTime(timeLeft)}
                        </div>

                        <p className="text-xs text-slate-400">You&apos;ll be asked to check in when the timer runs out</p>

                        <div className="flex gap-3">
                            <button onClick={checkIn} className="btn-primary text-sm" style={{ background: '#10b981' }}>
                                <CheckCircle size={16} className="inline mr-1" /> I&apos;m Safe
                            </button>
                            <button onClick={endSession} className="btn-ghost text-sm">End Session</button>
                        </div>
                    </motion.div>
                )}

                {/* ── CHECK-IN ──────────────────────────────────────────────── */}
                {state === 'checkin' && (
                    <motion.div key="checkin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6 py-8">
                        <div className="text-6xl animate-bounce">⚠️</div>
                        <h2 className="text-xl font-bold text-[#f5a623]">Are you okay?</h2>
                        <p className="text-sm text-slate-400 text-center max-w-sm">
                            Your timer has expired. Please confirm you&apos;re safe. If you don&apos;t respond in 30 seconds, an SOS will be sent automatically.
                        </p>
                        <button onClick={checkIn} className="btn-primary text-lg px-8 py-3" style={{ background: '#10b981' }}>
                            ✅ I&apos;m Safe!
                        </button>
                    </motion.div>
                )}

                {/* ── EXPIRED (SOS TRIGGERED) ───────────────────────────────── */}
                {state === 'expired' && (
                    <motion.div key="expired" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6 py-8">
                        <div className="w-20 h-20 rounded-full flex items-center justify-center animate-pulse" style={{ background: '#ef444420' }}>
                            <div className="text-5xl">🚨</div>
                        </div>
                        <div className="text-center">
                            <h2 className="text-2xl font-bold text-red-400 mb-2">SOS Auto-Triggered!</h2>
                            <p className="text-sm text-slate-400 max-w-sm">
                                HR and Security have been notified of your last known location.
                            </p>
                        </div>

                        {/* Location Sharing to Contacts */}
                        <div className="w-full glass-card border-red-500/30 bg-red-500/5 mt-2">
                            <h3 className="text-sm font-bold text-red-400 flex items-center gap-2 mb-3">
                                <AlertTriangle size={16} /> Alert Your Contacts Now
                            </h3>
                            <p className="text-xs text-slate-300 mb-4">
                                Click below to instantly send your live GPS location to your trusted contacts via WhatsApp or SMS.
                            </p>

                            <div className="space-y-3">
                                {contacts.map((c, i) => {
                                    // Strip non-numeric characters for the tel/wa links
                                    const cleanPhone = c.phone.replace(/\D/g, '');
                                    const mapsLink = `https://www.google.com/maps?q=12.9716,77.5946`;
                                    const message = encodeURIComponent(`🚨 URGENT: I missed my Guardian check-in on HearHer. Please check my live location immediately: ${mapsLink}`);

                                    return (
                                        <div key={i} className="flex flex-col sm:flex-row gap-2">
                                            <div className="flex-1 p-3 rounded-lg flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                                <div>
                                                    <p className="text-sm font-medium">{c.name}</p>
                                                    <p className="text-xs text-slate-400">{c.phone}</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <a
                                                    href={`https://wa.me/${cleanPhone}?text=${message}`}
                                                    target="_blank" rel="noopener noreferrer"
                                                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 rounded-lg text-xs font-bold transition-all hover:brightness-110"
                                                    style={{ background: '#25D366', color: '#fff' }}
                                                >
                                                    WhatsApp
                                                </a>
                                                <a
                                                    href={`sms:${cleanPhone}?body=${message}`}
                                                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 rounded-lg text-xs font-bold transition-all hover:brightness-110"
                                                    style={{ background: '#3b82f6', color: '#fff' }}
                                                >
                                                    SMS
                                                </a>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <button onClick={endSession} className="w-full py-4 mt-4 rounded-xl text-sm font-bold transition-all" style={{ background: '#10b98120', color: '#10b981', border: '1px solid #10b98140' }}>
                            I&apos;m safe now — End SOS & Resolve
                        </button>
                    </motion.div>
                )}

                {/* ── SAFE ──────────────────────────────────────────────────── */}
                {state === 'safe' && (
                    <motion.div key="safe" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 py-12">
                        <div className="text-6xl">💚</div>
                        <h2 className="text-xl font-bold text-emerald-400">You&apos;re safe!</h2>
                        <p className="text-sm text-slate-400">Guardian session ended. Stay strong! 💜</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
