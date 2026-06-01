/* ==========================================================================
   Q-MOD LANDING PAGE LOGIC & LIVE SIMULATOR
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // 1. DOM Elements & State
    const btnKeysMode = document.getElementById('btn-mode-keys');
    const btnMixerMode = document.getElementById('btn-mode-mixer');
    const panelKeysMode = document.getElementById('panel-keys-mode');
    const panelMixerMode = document.getElementById('panel-mixer-mode');
    const consoleLogs = document.getElementById('console-logs');
    
    const healthRoutingState = document.getElementById('health-routing-state');
    const healthActivePort = document.getElementById('health-active-port');
    const healthPortIsolation = document.getElementById('health-port-isolation');
    
    const trackpadEmulator = document.getElementById('trackpad-emulator');
    const trackpadCursor = document.getElementById('trackpad-cursor');
    const canvas = document.getElementById('canvas-oscilloscope');
    const ctx = canvas.getContext('2d');

    let activeMode = 'keys'; // 'keys' or 'mixer'
    let selectedTrack = 1;   // 1 to 8 in Mixer Mode
    
    // Map virtual mixer track states
    const mixerState = {};
    for (let track = 1; track <= 8; track++) {
        mixerState[track] = {
            volume: track === 1 ? 78 : (track === 2 ? 60 : (track === 3 ? 45 : (track === 4 ? 70 : (track === 5 ? 80 : (track === 6 ? 50 : (track === 7 ? 65 : 30)))))),
            pan: 64 // center
        };
    }

    // 2. Web Audio API Synthesizer Setup
    let audioCtx = null;
    let mainGainNode = null;
    let analyserNode = null;
    let mainFilterNode = null;
    const activeOscillators = {}; // Maps note -> { osc, gain }

    function initAudio() {
        if (audioCtx) return;
        
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
        
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
        
        mainFilterNode = audioCtx.createBiquadFilter();
        mainFilterNode.type = 'lowpass';
        mainFilterNode.frequency.setValueAtTime(1500, audioCtx.currentTime);
        mainFilterNode.Q.setValueAtTime(1.5, audioCtx.currentTime);
        
        mainGainNode = audioCtx.createGain();
        mainGainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        
        // Connections: oscs -> mainFilterNode -> analyserNode -> mainGainNode -> destination
        mainFilterNode.connect(analyserNode);
        analyserNode.connect(mainGainNode);
        mainGainNode.connect(audioCtx.destination);
        
        appendLog('system', 'Web Audio API Initialized. Polyphonic Synth Engine Online.');
    }

    // Convert MIDI note to Frequency
    function midiNoteToFrequency(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    // 3. Synth Polyphonic Note Handling
    function playNote(note, velocity = 0.75) {
        initAudio();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        // Prevent duplicate oscillator triggers for the same note
        if (activeOscillators[note]) {
            stopNote(note);
        }

        const osc = audioCtx.createOscillator();
        const noteGain = audioCtx.createGain();
        
        // Triangle/Sawtooth mix warmth
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(midiNoteToFrequency(note), audioCtx.currentTime);
        
        // Quick attack envelope
        noteGain.gain.setValueAtTime(0, audioCtx.currentTime);
        noteGain.gain.linearRampToValueAtTime(velocity * 0.4, audioCtx.currentTime + 0.05);
        
        osc.connect(noteGain);
        noteGain.connect(mainFilterNode);
        
        osc.start();
        
        activeOscillators[note] = { osc, gain: noteGain };
        
        // Forensic Inspector MIDI Log
        const hexNote = '0x' + note.toString(16).toUpperCase();
        const hexVel = '0x' + Math.round(velocity * 127).toString(16).toUpperCase();
        appendLog('note-on', `[MMBC] PORT A (PERFORMANCE) OUT: 0x90 ${hexNote} ${hexVel} | Note On [${note}]`);
    }

    function stopNote(note) {
        if (!activeOscillators[note]) return;
        
        const { osc, gain } = activeOscillators[note];
        delete activeOscillators[note];
        
        // Exponential decay envelope
        try {
            gain.gain.cancelScheduledValues(audioCtx.currentTime);
            gain.gain.setValueAtTime(gain.gain.value, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
            
            setTimeout(() => {
                try {
                    osc.stop();
                    osc.disconnect();
                    gain.disconnect();
                } catch(e) {}
            }, 350);
        } catch(e) {
            try { osc.stop(); } catch(_) {}
        }
        
        // Forensic Inspector MIDI Log
        const hexNote = '0x' + note.toString(16).toUpperCase();
        appendLog('note-off', `[MMBC] PORT A (PERFORMANCE) OUT: 0x80 ${hexNote} 0x00 | Note Off [${note}]`);
    }

    // 4. Interactive Logging
    function appendLog(type, message) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        
        const formatter = new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3,
            hour12: false
        });
        const ts = formatter.format(new Date());
        
        entry.innerHTML = `<span class="log-ts">[${ts}]</span> ${message}`;
        consoleLogs.appendChild(entry);
        consoleLogs.scrollTop = consoleLogs.scrollHeight;
        
        // Keep logs capped at 100 entries for stability
        if (consoleLogs.childElementCount > 100) {
            consoleLogs.removeChild(consoleLogs.firstChild);
        }
    }

    // 5. Trackpad Modulation & Expression
    let isDraggingTrackpad = false;

    function handleTrackpadMove(e) {
        const rect = trackpadEmulator.getBoundingClientRect();
        let x = (e.clientX - rect.left) / rect.width;
        let y = (e.clientY - rect.top) / rect.height;
        
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));
        
        // Update Cursor visual
        trackpadCursor.style.left = `${x * 100}%`;
        trackpadCursor.style.top = `${y * 100}%`;
        
        // Map Y to Filter Lowpass Frequency (150Hz to 6000Hz)
        if (mainFilterNode && audioCtx) {
            const freq = 150 + (1 - y) * 5850;
            mainFilterNode.frequency.setValueAtTime(freq, audioCtx.currentTime);
        }
        
        // Map X to Pitch Bend (-1.0 to +1.0)
        const bendValue = (x * 2) - 1;
        
        // Update active oscillators frequency for pitch bend
        if (audioCtx) {
            Object.keys(activeOscillators).forEach(note => {
                const baseFreq = midiNoteToFrequency(parseInt(note));
                const bentFreq = baseFreq * Math.pow(2, (bendValue * 2) / 12); // max 2 semitones bend
                activeOscillators[note].osc.frequency.setValueAtTime(bentFreq, audioCtx.currentTime);
            });
        }
        
        // Log CC & Pitch bend updates
        if (Math.random() < 0.15) { // rate limit logs slightly to not choke UI
            const ccFilterVal = Math.round((1 - y) * 127);
            const pbHexLsb = '0x' + Math.round(x * 127).toString(16).toUpperCase();
            appendLog('note-on', `[MMBC] PORT A CC74 (FILTER): ${ccFilterVal} | PB X-Axis: ${pbHexLsb}`);
        }
    }

    trackpadEmulator.addEventListener('mousedown', (e) => {
        isDraggingTrackpad = true;
        initAudio();
        handleTrackpadMove(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingTrackpad) {
            handleTrackpadMove(e);
        }
    });

    window.addEventListener('mouseup', () => {
        if (isDraggingTrackpad) {
            isDraggingTrackpad = false;
            // Snaps cursor back to center smoothly
            trackpadCursor.style.left = '50%';
            trackpadCursor.style.top = '50%';
            if (mainFilterNode && audioCtx) {
                mainFilterNode.frequency.exponentialRampToValueAtTime(1500, audioCtx.currentTime + 0.2);
            }
            // Reset Pitch Bend
            Object.keys(activeOscillators).forEach(note => {
                activeOscillators[note].osc.frequency.setValueAtTime(midiNoteToFrequency(parseInt(note)), audioCtx.currentTime + 0.1);
            });
        }
    });

    // 6. Mode Switch logic
    function switchMode(mode) {
        if (activeMode === mode) return;
        activeMode = mode;

        if (mode === 'keys') {
            btnKeysMode.classList.add('active');
            btnMixerMode.classList.remove('active');
            panelKeysMode.classList.remove('hidden');
            panelMixerMode.classList.add('hidden');
            
            healthRoutingState.textContent = 'PERFORMANCE';
            healthRoutingState.className = 'health-val text-cyan';
            healthActivePort.textContent = 'PORT A (PERFORMANCE)';
            healthActivePort.className = 'health-val text-cyan';
            
            appendLog('system', '[MMBC] MODE SWITCH: switched to keys (Performance Mode active)');
        } else {
            btnKeysMode.classList.remove('active');
            btnMixerMode.classList.add('active');
            panelKeysMode.classList.add('hidden');
            panelMixerMode.classList.remove('hidden');
            
            healthRoutingState.textContent = 'MIXER (MCU)';
            healthRoutingState.className = 'health-val text-green';
            healthActivePort.textContent = 'PORT B (MIXER)';
            healthActivePort.className = 'health-val text-green';
            
            // Release any active synthesizer notes to prevent stuck sounds
            Object.keys(activeOscillators).forEach(note => stopNote(parseInt(note)));
            
            appendLog('system', '[MMBC] MODE SWITCH: switched to mixer (Mackie MCU Mode active)');
            retransmitMixerSelection();
        }
    }

    btnKeysMode.addEventListener('click', () => switchMode('keys'));
    btnMixerMode.addEventListener('click', () => switchMode('mixer'));

    // 7. Physical Keyboard Event Bindings
    // Mapping: Q-MOD custom piano keyboard mapping matching KeyboardInputManager.swift
    const keyCodeNoteMap = {
        'KeyA': 60, // A -> C4
        'KeyW': 61, // W -> C#4
        'KeyS': 62, // S -> D4
        'KeyE': 63, // E -> D#4
        'KeyD': 64, // D -> E4
        'KeyF': 65, // F -> F4
        'KeyT': 66, // T -> F#4
        'KeyG': 67, // G -> G4
        'KeyY': 68, // Y -> G#4
        'KeyH': 69, // H -> A4
        'KeyU': 70, // U -> A#4
        'KeyJ': 71, // J -> B4
        'KeyK': 72  // K -> C5
    };

    const keyCodeMixerMap = {
        'Digit1': 1, 'Digit2': 2, 'Digit3': 3, 'Digit4': 4,
        'Digit5': 5, 'Digit6': 6, 'Digit7': 7, 'Digit8': 8
    };

    window.addEventListener('keydown', (e) => {
        // Prevent default window scrolling with arrow/space keys when simulator is focused
        const activeInput = document.activeElement;
        if (activeInput && (activeInput.tagName === 'INPUT' || activeInput.tagName === 'TEXTAREA')) {
            return;
        }

        // KEYS MODE Handling
        if (activeMode === 'keys') {
            const note = keyCodeNoteMap[e.code];
            if (note && !e.repeat) {
                playNote(note);
                // Highlight virtual key
                const keyEl = document.querySelector(`.piano-key[data-note="${note}"]`);
                if (keyEl) keyEl.classList.add('active');
            }
        } 
        // MIXER MODE Handling
        else if (activeMode === 'mixer') {
            // Track Selection (1-8)
            const track = keyCodeMixerMap[e.code];
            if (track) {
                e.preventDefault();
                selectMixerTrack(track);
            }
            
            // Arrow controls (Fader/Pan)
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
                if (e.code === 'ArrowUp') adjustFader(selectedTrack, 4);
                if (e.code === 'ArrowDown') adjustFader(selectedTrack, -4);
                if (e.code === 'ArrowLeft') adjustPan(selectedTrack, -8);
                if (e.code === 'ArrowRight') adjustPan(selectedTrack, 8);
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (activeMode === 'keys') {
            const note = keyCodeNoteMap[e.code];
            if (note) {
                stopNote(note);
                // Unhighlight virtual key
                const keyEl = document.querySelector(`.piano-key[data-note="${note}"]`);
                if (keyEl) keyEl.classList.remove('active');
            }
        }
    });

    // 8. Virtual Screen Interactions (Mouse Clicks on Piano Keys)
    document.querySelectorAll('.piano-key').forEach(key => {
        key.addEventListener('mousedown', () => {
            const note = parseInt(key.getAttribute('data-note'));
            playNote(note);
            key.classList.add('active');
        });

        key.addEventListener('mouseup', () => {
            const note = parseInt(key.getAttribute('data-note'));
            stopNote(note);
            key.classList.remove('active');
        });
        
        key.addEventListener('mouseleave', () => {
            const note = parseInt(key.getAttribute('data-note'));
            stopNote(note);
            key.classList.remove('active');
        });
    });

    // 9. Mixer MCU Core Logic
    function selectMixerTrack(track) {
        if (track < 1 || track > 8) return;
        
        // Remove active state from old track
        const oldTrackEl = document.querySelector(`.mixer-track[data-track="${selectedTrack}"]`);
        if (oldTrackEl) {
            oldTrackEl.classList.remove('active');
            oldTrackEl.querySelector('.track-indicator').textContent = '';
        }
        
        selectedTrack = track;
        
        // Add active state to new track
        const newTrackEl = document.querySelector(`.mixer-track[data-track="${selectedTrack}"]`);
        if (newTrackEl) {
            newTrackEl.classList.add('active');
            newTrackEl.querySelector('.track-indicator').textContent = 'SEL';
        }
        
        retransmitMixerSelection();
    }

    function retransmitMixerSelection() {
        const note = 24 + (selectedTrack - 1);
        const hexNote = '0x' + note.toString(16).toUpperCase();
        
        // Clear any possible audio leakage logs
        appendLog('mcu', `[MMBC] PORT B (MIXER) OUT: 0x90 ${hexNote} 0x7F | Mackie Select CH${selectedTrack} NoteOn`);
        appendLog('mcu', `[MMBC] PORT B (MIXER) OUT: 0x90 ${hexNote} 0x00 | Mackie Select CH${selectedTrack} NoteOff`);
    }

    function adjustFader(track, step) {
        const current = mixerState[track].volume;
        const next = Math.max(0, Math.min(127, current + step));
        mixerState[track].volume = next;
        
        // Update DOM visual
        const trackEl = document.querySelector(`.mixer-track[data-track="${track}"]`);
        if (trackEl) {
            trackEl.querySelector('.track-val').textContent = `${Math.round(next / 1.27)}%`;
            trackEl.querySelector('.fader-handle').style.bottom = `${next / 1.27}%`;
        }
        
        // In MCU, volume is sent as a Pitch Bend message on channels 0-7
        const pbVal = next;
        const hexStatus = '0x' + (0xE0 + (track - 1)).toString(16).toUpperCase();
        const hexLsb = '0x' + (pbVal & 0x7F).toString(16).toUpperCase();
        const hexMsb = '0x' + ((pbVal >> 7) & 0x7F).toString(16).toUpperCase();
        
        appendLog('mcu', `[MMBC] PORT B (MIXER) OUT: ${hexStatus} ${hexLsb} ${hexMsb} | Mackie Fader CH${track} Volume: ${pbVal}`);
    }

    function adjustPan(track, step) {
        const current = mixerState[track].pan;
        const next = Math.max(0, Math.min(127, current + step));
        mixerState[track].pan = next;
        
        // Update DOM visual
        const trackEl = document.querySelector(`.mixer-track[data-track="${track}"]`);
        if (trackEl) {
            const rot = ((next - 64) / 64) * 120; // dial rotation in degrees
            trackEl.querySelector('.pan-knob').style.transform = `rotate(${rot}deg)`;
            
            let label = 'C';
            if (next < 64) label = `L${64 - next}`;
            if (next > 64) label = `R${next - 64}`;
            trackEl.querySelector('.pan-label').textContent = label;
        }
        
        // In MCU, pan is sent as CC 16-23 on channel 0
        const cc = 16 + (track - 1);
        const hexCc = '0x' + cc.toString(16).toUpperCase();
        const vpotVal = step > 0 ? 1 : 65; // Relative rotary encoding representation
        const hexVal = '0x' + vpotVal.toString(16).toUpperCase();
        
        appendLog('mcu', `[MMBC] PORT B (MIXER) OUT: 0xB0 ${hexCc} ${hexVal} | Mackie Pan V-Pot CH${track} Delta: ${step}`);
    }

    // Bind virtual mixer clicks
    document.querySelectorAll('.mixer-track').forEach(trackEl => {
        const trackNum = parseInt(trackEl.getAttribute('data-track'));
        
        trackEl.addEventListener('click', () => {
            selectMixerTrack(trackNum);
        });

        // Simple mouse wheel adjusting inside track area
        trackEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (activeMode !== 'mixer') return;
            selectMixerTrack(trackNum);
            
            const step = e.deltaY < 0 ? 4 : -4;
            adjustFader(trackNum, step);
        });
    });

    // 10. Glowing Oscilloscope Animation Loop
    function resizeCanvas() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    }
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const dataArray = new Uint8Array(128);
    let passivePhase = 0;

    function animateWave() {
        requestAnimationFrame(animateWave);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3;
        
        // Set glowing visual shadow matching the theme
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'rgba(0, 240, 255, 0.6)';
        
        ctx.beginPath();
        
        const sliceWidth = canvas.width / 128;
        let x = 0;
        
        // Active Waveform if notes are playing
        if (analyserNode && Object.keys(activeOscillators).length > 0) {
            analyserNode.getByteTimeDomainData(dataArray);
            
            for (let i = 0; i < 128; i++) {
                const v = dataArray[i] / 128.0; // 0.0 to 2.0
                const y = v * (canvas.height / 2);
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                
                x += sliceWidth;
            }
        } 
        // Passive Beautiful Waveform scanning across screen
        else {
            passivePhase += 0.03;
            for (let i = 0; i < 128; i++) {
                const sine = Math.sin((i / 128) * Math.PI * 4 + passivePhase);
                // soft pulsing scale
                const pulse = 0.15 + 0.05 * Math.sin(passivePhase * 0.5);
                const y = (canvas.height / 2) + sine * (canvas.height / 2) * pulse;
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                
                x += sliceWidth;
            }
        }
        
        ctx.stroke();
    }
    
    animateWave();
});
