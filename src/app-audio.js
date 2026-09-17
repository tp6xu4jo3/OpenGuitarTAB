    function getTempo() {
      const raw = Number(tempoInput.value);
      const tempo = Number.isFinite(raw) ? raw : 120;
      const clamped = Math.min(300, Math.max(30, Math.round(tempo)));
      tempoInput.value = clamped;
      return clamped;
    }

    function getCapo() {
      const raw = Number(capoInput.value);
      const capo = Number.isFinite(raw) ? raw : 0;
      const clamped = Math.min(12, Math.max(0, Math.round(capo)));
      capoInput.value = clamped;
      return clamped;
    }

    function getSlotDurationMs() {
      const tempo = getTempo();
      const beatDurationMs = 60000 / tempo;
      return beatDurationMs / 4;
    }

    function totalSlots() {
      const logicalRows = document.querySelectorAll('.tab-grid[data-row]').length;
      return Math.max(1, logicalRows * positionsPerRow());
    }

    function slotToIndex(row, position) {
      return clamp(row * positionsPerRow() + position, 0, totalSlots() - 1);
    }

    function indexToSlot(index) {
      const cleanIndex = clamp(Number(index) || 0, 0, totalSlots() - 1);
      const positions = positionsPerRow();
      return { row: Math.floor(cleanIndex / positions), position: cleanIndex % positions };
    }

    function updateProgressRange() {
      const max = totalSlots() - 1;
      playProgress.max = String(max);
      playProgress.value = String(clamp(Number(playProgress.value) || 0, 0, max));
      updateProgressLabel(Number(playProgress.value));
    }

    function updateProgressLabel(index) {
      const { row, position } = indexToSlot(index);
      progressLabel.textContent = `第 ${row + 1} 列 / 第 ${position + 1} 格`;
    }

    function jumpToInput(input, highlight) {
      const row = Number(input.dataset.row);
      const position = Number(input.dataset.position);
      setProgressIndex(slotToIndex(row, position), true, highlight);
    }

    function setProgressIndex(index, updateSlider = true, highlight = true) {
      playIndex = clamp(Number(index) || 0, 0, totalSlots() - 1);
      if (updateSlider) playProgress.value = String(playIndex);
      updateProgressLabel(playIndex);
      if (highlight) {
        const { row, position } = indexToSlot(playIndex);
        highlightPlayhead(row, position);
      }
    }

    function getInputsAt(row, position) {
      return Array.from(document.querySelectorAll(`.note-input[data-row="${row}"][data-position="${position}"]`));
    }

    function getFilledInputsAt(row, position) {
      return getInputsAt(row, position).filter(input => input.value.trim() !== '');
    }

    function highlightPlayhead(row, position) {
      clearPlayhead();
      currentPlayhead = getInputsAt(row, position);
      currentPlayhead.forEach(input => input.classList.add('is-playing'));
    }

    function clearPlayhead() {
      if (!currentPlayhead) return;
      currentPlayhead.forEach(input => input.classList.remove('is-playing'));
      currentPlayhead = null;
    }

    function setupAudio() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        alert('這個瀏覽器不支援 Web Audio API，無法播放音效。');
        return null;
      }
      if (!audioContext) {
        audioContext = new AudioContextClass();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 1.38;
        compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 14;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.22;
        masterGain.connect(compressor);
        compressor.connect(audioContext.destination);
      }
      return audioContext;
    }

    async function ensureAudioReady() {
      const ctx = setupAudio();
      if (!ctx) return false;
      if (ctx.state === 'suspended') await ctx.resume();
      return true;
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function getTabFrequency(stringIndex, fret) {
      const cleanStringIndex = Math.max(0, Math.min(STRING_TUNING.length - 1, Number(stringIndex) || 0));
      const cleanFret = Math.max(0, Math.min(36, Number(fret) || 0));
      const soundingFret = cleanFret + getCapo();
      return STRING_TUNING[cleanStringIndex].frequency * Math.pow(2, soundingFret / 12);
    }

    function stopStringVoice(stringIndex, releaseSeconds = 0.018) {
      const voice = activeStringVoices[stringIndex];
      if (!voice || !audioContext) return;
      activeStringVoices[stringIndex] = null;
      const now = audioContext.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds);
      window.setTimeout(() => voice.stop(), (releaseSeconds + 0.05) * 1000);
    }

    function stopAllStringVoices() {
      for (let stringIndex = 0; stringIndex < STRINGS; stringIndex++) stopStringVoice(stringIndex, 0.025);
    }

    function playGuitarNote(stringIndex, fret) {
      if (!audioContext || !masterGain) return;
      const frequency = getTabFrequency(stringIndex, fret);
      const now = audioContext.currentTime;
      const duration = 0.5;
      const peakLevel = stringIndex >= 4 ? 0.58 : 0.50;
      stopStringVoice(stringIndex);
      const sourceBus = audioContext.createGain();
      const bodyLow = audioContext.createBiquadFilter();
      const bodyMid = audioContext.createBiquadFilter();
      const bodyPresence = audioContext.createBiquadFilter();
      const bodyHighCut = audioContext.createBiquadFilter();
      const noteGain = audioContext.createGain();
      noteGain.gain.setValueAtTime(0.0001, now);
      noteGain.gain.exponentialRampToValueAtTime(peakLevel, now + 0.004);
      noteGain.gain.exponentialRampToValueAtTime(peakLevel * 0.62, now + 0.045);
      noteGain.gain.exponentialRampToValueAtTime(peakLevel * 0.14, now + duration * 0.86);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      bodyLow.type = 'peaking';
      bodyLow.frequency.setValueAtTime(stringIndex >= 4 ? 105 : 160, now);
      bodyLow.Q.setValueAtTime(0.82, now);
      bodyLow.gain.setValueAtTime(stringIndex >= 4 ? 3.4 : 1.9, now);
      bodyMid.type = 'peaking';
      bodyMid.frequency.setValueAtTime(320, now);
      bodyMid.Q.setValueAtTime(1.05, now);
      bodyMid.gain.setValueAtTime(2.2, now);
      bodyPresence.type = 'peaking';
      bodyPresence.frequency.setValueAtTime(clamp(frequency * 5.8, 1450, 3900), now);
      bodyPresence.Q.setValueAtTime(0.86, now);
      bodyPresence.gain.setValueAtTime(1.7, now);
      bodyHighCut.type = 'lowpass';
      bodyHighCut.frequency.setValueAtTime(clamp(frequency * 12, 2500, 7600), now);
      bodyHighCut.frequency.exponentialRampToValueAtTime(clamp(frequency * 5.2, 1200, 5600), now + duration);
      bodyHighCut.Q.setValueAtTime(0.55, now);
      const stringSource = connectPluckedString(frequency, stringIndex, now, duration, sourceBus);
      const pickSource = addPickNoise(now, sourceBus);
      sourceBus.connect(bodyLow); bodyLow.connect(bodyMid); bodyMid.connect(bodyPresence); bodyPresence.connect(bodyHighCut); bodyHighCut.connect(noteGain); noteGain.connect(masterGain);
      let stopped = false;
      let cleanupTimer = null;
      const voice = {
        gain: noteGain,
        stop() {
          if (stopped) return;
          stopped = true;
          if (cleanupTimer) clearTimeout(cleanupTimer);
          try { stringSource.stop(); } catch (error) {}
          try { pickSource.stop(); } catch (error) {}
          try { sourceBus.disconnect(); } catch (error) {}
          try { bodyLow.disconnect(); } catch (error) {}
          try { bodyMid.disconnect(); } catch (error) {}
          try { bodyPresence.disconnect(); } catch (error) {}
          try { bodyHighCut.disconnect(); } catch (error) {}
          try { noteGain.disconnect(); } catch (error) {}
          if (activeStringVoices[stringIndex] === voice) activeStringVoices[stringIndex] = null;
        }
      };
      activeStringVoices[stringIndex] = voice;
      cleanupTimer = setTimeout(() => voice.stop(), (duration + 0.12) * 1000);
    }
